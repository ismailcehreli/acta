import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { appSecret } from "./config";
import { hashPassword } from "./password";
import { issueResetToken, verifyResetToken } from "./reset-token";
import { revokeAllUserSessions } from "./session";



//




export type ResetDb = Pick<
  PrismaClient,
  | "user"
  | "userCredential"
  | "notificationQueue"
  | "systemSetting"
  | "session"
  | "auditLog"
  | "$transaction"
>;

export type ResetRequestOutcome = {

  issued: boolean;
};

export async function requestPasswordReset(
  db: ResetDb,
  email: string,
  now: Date,
  secret: string = appSecret(),
): Promise<ResetRequestOutcome> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isActive: true, credential: { select: { version: true } } },
  });



  if (!user || !user.isActive || !user.credential) return { issued: false };

  const token = issueResetToken(user.id, user.credential.version, now, secret);




  await enqueueNotification(db, {
    userId: user.id,
    eventType: NOTIFICATION_EVENTS.passwordReset,
    payload: { token },


    idempotencyKey: `password_reset:${user.id}:${user.credential.version}`,
    now,
  });

  return { issued: true };
}

/**
 * Queues a welcome email for a newly created account.
 *
 * **Never include a password in email** (§15.3). Tell the user the system
 * address and login address, then send a reset token so they can set their own
 * password. Mailing a password would leave it indefinitely in the mailbox,
 * backups, and search results.
 *
 * Failures are visible: if the account is created but the email cannot be
 * queued, the caller receives that result and can tell the user.
 */
export async function sendWelcomeEmail(
  db: ResetDb,
  userId: string,
  now: Date,
  secret: string = appSecret(),
): Promise<{ ok: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, credential: { select: { version: true } } },
  });

  if (!user || !user.isActive || !user.credential) return { ok: false };

  const token = issueResetToken(userId, user.credential.version, now, secret);

  await enqueueNotification(db, {
    userId,
    eventType: NOTIFICATION_EVENTS.accountCreated,
    payload: { token },
    idempotencyKey: `account_created:${userId}`,
    now,
  });

  return { ok: true };
}

/**
 * Sends a reset link for a known user (Task 11.7).
 *
 * A unit manager or system administrator triggers this. **The password does
 * not change**: only the link is sent and the user chooses the password. A
 * password chosen by a manager is known to that manager, weakening the answer
 * to "who performed this action" and reducing audit value.
 *
 * This differs from `requestPasswordReset`, which accepts an **email** and
 * always returns the same result to prevent account enumeration. Here the
 * target is already known, so the caller should see the result.
 */
export async function sendPasswordResetForUser(
  db: ResetDb,
  userId: string,
  now: Date,
  secret: string = appSecret(),
): Promise<{ ok: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, credential: { select: { version: true } } },
  });

  // Do not send a link to an inactive account: changing its password does not
  // reactivate it.
  if (!user || !user.isActive || !user.credential) return { ok: false };

  const token = issueResetToken(userId, user.credential.version, now, secret);

  await enqueueNotification(db, {
    userId,
    eventType: NOTIFICATION_EVENTS.passwordReset,
    payload: { token },
    // The credential version is part of the idempotency key: a second request
    // in the same version does not queue another email while the first link is
    // still valid.
    idempotencyKey: `password_reset:${userId}:${user.credential.version}`,
    now,
  });

  return { ok: true };
}

export type ResetResult =
  | { ok: true; revokedSessionCount: number }
  | { ok: false; reason: "invalid_token" | "expired_token" | "used_token" };

export async function resetPassword(
  db: ResetDb,
  token: string,
  newPassword: string,
  now: Date,
  secret: string = appSecret(),
): Promise<ResetResult> {
  const verified = verifyResetToken(token, now, secret);

  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason === "expired" ? "expired_token" : "invalid_token",
    };
  }

  const passwordHash = await hashPassword(newPassword);

  const revokedSessionCount = await db.$transaction(async (tx) => {
    // The write is **conditional**: update only while the credential row still
    // has the version in which the token was issued. A newer version means the
    // token was used or the password changed through another path; reject the
    // second use here.
    const written = await tx.userCredential.updateMany({
      where: { userId: verified.userId, version: verified.credentialVersion },
      data: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        version: { increment: 1 },
        // Resetting also unlocks the account: a locked user must be able to
        // reset their password instead of waiting out the lock.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (written.count === 0) return null;

    // A password change invalidates all remaining sessions (§15.3).
    const revokedSessionCount = await revokeAllUserSessions(tx, verified.userId, now);

    await recordAudit(tx, {
      userId: verified.userId,
      objectType: AUDIT_OBJECTS.user,
      objectId: verified.userId,
      action: AUDIT_ACTIONS.userPasswordReset,
      detail: { revokedSessionCount },
      now,
    });

    return revokedSessionCount;
  });

  if (revokedSessionCount === null) return { ok: false, reason: "used_token" };

  return { ok: true, revokedSessionCount };
}
