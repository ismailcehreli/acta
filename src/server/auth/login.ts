import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import {
  isLockThresholdReached,
  isLocked,
  lockUntil,
  loginDelayMs,
} from "./lockout";
import { hashPassword, verifyPassword } from "./password";
import { clearFailures, peekFailures, recordFailure } from "./rate-limit";
import {
  createSessionIfCredentialUnchanged,
  type CreatedSession,
} from "./session";


// The current time is injected so the rule can be tested with a fake clock
// without waiting.

export type LoginFailureReason =

  | "invalid_credentials"

  | "locked"
  | "rate_limited";

export type LoginResult =
  | {
      ok: true;
      userId: string;
      session: CreatedSession;
      mustChangePassword: boolean;
    }
  | {
      ok: false;
      reason: LoginFailureReason;

      retryAfterMs?: number;
    };


export type LoginDb = Pick<
  PrismaClient,
  | "user"
  | "userCredential"
  | "session"
  | "systemSetting"
  | "auditLog"
  | "$queryRaw"
  | "$transaction"
>;

export interface LoginDependencies {
  db: LoginDb;
  now: Date;

  rateLimitKey: string;

  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));


let dummyHash: Promise<string> | null = null;


async function burnTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("invalid-password-placeholder");
  await verifyPassword(await dummyHash, password);
}

export async function login(
  deps: LoginDependencies,
  input: {
    email: string;
    password: string;

    remember?: boolean;
  },
): Promise<LoginResult> {
  const { db, now, rateLimitKey } = deps;
  const sleep = deps.sleep ?? defaultSleep;

  const clientKey = `client:${rateLimitKey}`;
  // The client address comes from a header and can be changed; the attempted
  // account cannot. Keep both counters independently.
  const accountKey = `account:${input.email}`;
  const clock = now.getTime();

  const byClient = peekFailures(clientKey, clock);
  const byAccount = peekFailures(accountKey, clock);

  if (byClient.blocked || byAccount.blocked) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterMs: Math.max(byClient.retryAfterMs, byAccount.retryAfterMs),
    };
  }

  /** Records a failed attempt in both counters. */
  const noteFailure = () => {
    recordFailure(clientKey, clock);
    recordFailure(accountKey, clock);
  };

  const user = await db.user.findUnique({
    where: { email: input.email },
    include: { credential: true },
  });

  if (!user || !user.credential || !user.isActive) {
    // Apply the same delay profile as for a known account: a missing delay
    // would reveal that the email address is not registered.
    await sleep(loginDelayMs(byAccount.count));
    await burnTime(input.password);
    noteFailure();

    // §15.2 "login attempts": attempts against an unknown or inactive account
    // are also audited. There is no user when the account is unknown; the
    // attempted address remains in the details.
    await recordAudit(db, {
      userId: user?.id ?? null,
      objectType: AUDIT_OBJECTS.session,
      objectId: input.email,
      action: AUDIT_ACTIONS.loginFailed,
      detail: { email: input.email, reason: user ? "inactive" : "unknown_email" },
      ipAddress: deps.rateLimitKey,
      now,
    });

    return { ok: false, reason: "invalid_credentials" };
  }

  const credential = user.credential;
  const { lockedUntil } = credential;

  if (isLocked(lockedUntil, now)) {
    // A locked account pays the same delay and password-verification cost as
    // other paths. Returning immediately leaked "this email is registered and
    // active" through response time (phase 2 audit, finding 2).
    await sleep(loginDelayMs(byAccount.count));
    await burnTime(input.password);
    noteFailure();

    return {
      ok: false,
      reason: "locked",
      retryAfterMs: lockedUntil.getTime() - now.getTime(),
    };
  }

  // Once the lock expires, start the counter from zero. Perform cleanup in one
  // statement so concurrent requests cannot observe a partial state.
  let previousFailures = credential.failedLoginCount;
  if (credential.lockedUntil !== null) {
    await db.userCredential.updateMany({
      where: { userId: user.id, lockedUntil: { lte: now } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    previousFailures = 0;
  }

  await sleep(loginDelayMs(previousFailures));

  const passwordMatches = await verifyPassword(
    credential.passwordHash,
    input.password,
  );

  if (!passwordMatches) {
    // Increment the counter atomically in the database. Read-then-write caused
    // lost updates for concurrent attempts and could prevent the lock from
    // activating (audit, finding 6).
    const { failedLoginCount } = await db.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    noteFailure();

    if (isLockThresholdReached(failedLoginCount)) {
      const lockoutMinutes = await readNumericSetting(
        db,
        SETTING_KEYS.lockoutMinutes,
      );
      const lockedTo = lockUntil(now, lockoutMinutes);

      await db.userCredential.update({
        where: { userId: user.id },
        data: { lockedUntil: lockedTo },
      });

      await recordAudit(db, {
        userId: user.id,
        objectType: AUDIT_OBJECTS.session,
        objectId: user.id,
        action: AUDIT_ACTIONS.loginLocked,
        detail: { failedLoginCount, lockedUntil: lockedTo.toISOString() },
        ipAddress: deps.rateLimitKey,
        now,
      });

      return {
        ok: false,
        reason: "locked",
        retryAfterMs: lockedTo.getTime() - now.getTime(),
      };
    }

    await recordAudit(db, {
      userId: user.id,
      objectType: AUDIT_OBJECTS.session,
      objectId: user.id,
      action: AUDIT_ACTIONS.loginFailed,
      detail: { reason: "wrong_password", failedLoginCount },
      ipAddress: deps.rateLimitKey,
      now,
    });

    return { ok: false, reason: "invalid_credentials" };
  }

  await db.userCredential.update({
    where: { userId: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  // A successful login clears the counters: a legitimate user should not lock
  // themselves or colleagues sharing the same address through frequent use.
  clearFailures(clientKey);
  clearFailures(accountKey);

  // Create a session only if the verified credential version is still current:
  // the password may have changed between verification and session creation.
  // With "Remember me", the session lasts the configured number of days. A
  // setting of 0 disables the feature and the client value is ignored.
  const rememberDay = await readNumericSetting(db, SETTING_KEYS.rememberMeDays);
  const sessionHours =
    input.remember && rememberDay > 0 ? rememberDay * 24 : undefined;

  const session = await createSessionIfCredentialUnchanged(
    db,
    user.id,
    credential.version,
    now,
    sessionHours,
  );

  if (!session) {
    // The password changed at this exact moment; the verified password is no
    // longer current.
    return { ok: false, reason: "invalid_credentials" };
  }

  // Update the last-login time only after both password verification and
  // session creation succeed. Failed attempts and passwords invalidated by a
  // race must not change it.
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now },
  });

  await recordAudit(db, {
    userId: user.id,
    objectType: AUDIT_OBJECTS.session,
    objectId: session.sessionId,
    action: AUDIT_ACTIONS.loginSucceeded,
    ipAddress: deps.rateLimitKey,
    now,
  });

  return {
    ok: true,
    userId: user.id,
    session,
    mustChangePassword: credential.mustChangePassword,
  };
}
