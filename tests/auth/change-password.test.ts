import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { changePassword } from "@/server/auth/change-password";
import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import {
  createSession,
  createSessionIfCredentialUnchanged,
  findActiveSession,
} from "@/server/auth/session";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-456";

const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function newUser() {
  const unit = await createOrgUnit();
  return createUserWithPassword(unit.id, OLD_PASSWORD, {
    email: "manager@example.test",
  });
}

describe("password change", () => {
  it("change is not made if current password is wrong", async () => {
    const user = await newUser();

    const result = await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: "wrong-password",
        newPassword: NEW_PASSWORD,
      },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_current_password" });

    // Old password continues to work.
    const attempt = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "manager@example.test", password: OLD_PASSWORD },
    );
    expect(attempt.ok).toBe(true);
  });

  it("after change new password is valid, old password is invalid", async () => {
    const user = await newUser();

    await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    const withNew = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "manager@example.test", password: NEW_PASSWORD },
    );
    const withOld = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.2", sleep: noWait },
      { email: "manager@example.test", password: OLD_PASSWORD },
    );

    expect(withNew.ok).toBe(true);
    expect(withOld.ok).toBe(false);
  });

  it("all open sessions are revoked on password change (§15.3)", async () => {
    const user = await newUser();
    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    const result = await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    expect(result).toEqual({ ok: true, revokedSessionCount: 2 });
    expect(await findActiveSession(testDb, first.token, NOW)).toBeNull();
    expect(await findActiveSession(testDb, second.token, NOW)).toBeNull();
  });

  it("password change clears lockout and failed attempt counter", async () => {
    const user = await newUser();
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: 7, lockedUntil: new Date("2026-08-17T10:00:00.000Z") },
    });

    await changePassword(
      { db: testDb, now: NOW },
      {
        userId: user.id,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    );

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(0);
    expect(credential.lockedUntil).toBeNull();
    expect(credential.passwordChangedAt).toEqual(NOW);
  });
});

// Audit PHASE 2, finding 1: generation check relied on wall clock and only covered
// one direction. When password change started first and login intervened while hash
// was being computed, login timestamp could be greater and session deemed valid.
// Generation is now a monotonic counter.
describe("login racing with password change", () => {
  it("session is not opened if password changes during login", async () => {
    const user = await newUser();
    const loginTime = new Date("2026-08-17T09:00:00.000Z");
    const changeTime = new Date("2026-08-17T09:00:00.500Z");

    // Login waits after reading credential; right at that moment password
    // changes and generation advances.
    const result = await login(
      {
        db: testDb,
        now: loginTime,
        rateLimitKey: "10.0.0.1",
        sleep: async () => {
          await changePassword(
            { db: testDb, now: changeTime },
            {
              userId: user.id,
              currentPassword: OLD_PASSWORD,
              newPassword: NEW_PASSWORD,
            },
          );
        },
      },
      { email: "manager@example.test", password: OLD_PASSWORD },
    );

    // Even if old password was verified, session is not written.
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("session write is rejected if generation has advanced", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    // Login read generation 0; password changed before writing.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const session = await createSessionIfCredentialUnchanged(
      testDb,
      user.id,
      0,
      now,
    );

    expect(session).toBeNull();
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("session is written if generation is the same", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    const session = await createSessionIfCredentialUnchanged(
      testDb,
      user.id,
      0,
      now,
    );

    expect(session).not.toBeNull();
    if (!session) return;
    expect(await findActiveSession(testDb, session.token, now)).not.toBeNull();
  });

  it("session born in old generation cannot be used later", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");
    const session = await createSession(testDb, user.id, now, 0);

    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    expect(await findActiveSession(testDb, session.token, now)).toBeNull();
  });

  it("yields safe result even if password change and login truly conflict", async () => {
    const user = await newUser();
    const changeTime = new Date("2026-08-17T09:00:00.000Z");
    const loginTime = new Date("2026-08-17T09:00:00.200Z");

    // Two operations at the same time: password change (while hash computation is ongoing)
    // and login with old password. Whichever order occurs, result must be safe — login is
    // either rejected or session opened cannot be used.
    const [, loginResult] = await Promise.all([
      changePassword(
        { db: testDb, now: changeTime },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
        },
      ),
      login(
        { db: testDb, now: loginTime, rateLimitKey: "10.0.0.5", sleep: noWait },
        { email: "manager@example.test", password: OLD_PASSWORD },
      ),
    ]);

    if (loginResult.ok) {
      expect(
        await findActiveSession(testDb, loginResult.session.token, loginTime),
      ).toBeNull();
    } else {
      expect(loginResult.reason).toBe("invalid_credentials");
    }

    // In all cases: old password can no longer open any new session.
    const afterwards = await login(
      { db: testDb, now: loginTime, rateLimitKey: "10.0.0.6", sleep: noWait },
      { email: "manager@example.test", password: OLD_PASSWORD },
    );
    expect(afterwards.ok).toBe(false);
  });
});

// Audit (18.08.2026, finding 7): previous round only resolved race between login
// and password change. Two **password changes** could verify same old hash outside transaction
// and write sequentially; someone knowing old password could overwrite the real user's new password.
describe("two concurrent password changes", () => {
  it("only one writes, the other returns conflict", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    const [first, second] = await Promise.all([
      changePassword(
        { db: testDb, now },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: "real-user-password",
        },
      ),
      changePassword(
        { db: testDb, now },
        {
          userId: user.id,
          currentPassword: OLD_PASSWORD,
          newPassword: "attacker-password",
        },
      ),
    ]);

    const successful = [first, second].filter((r) => r.ok);
    const failed = [first, second].filter((r) => !r.ok);

    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toEqual({ ok: false, reason: "conflict" });
  });

  it("losing request's password is never valid", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");
    const after = new Date("2026-08-17T09:05:00.000Z");

    await Promise.all([
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "password-one-1234" },
      ),
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "password-two-1234" },
      ),
    ]);

    const attempts = await Promise.all(
      ["password-one-1234", "password-two-1234"].map((password, index) =>
        login(
          {
            db: testDb,
            now: after,
            rateLimitKey: `10.0.0.${20 + index}`,
            sleep: noWait,
          },
          { email: "manager@example.test", password },
        ),
      ),
    );

    // Exactly one should work: if both passwords were valid, owner of losing request could also access account.
    expect(attempts.filter((r) => r.ok)).toHaveLength(1);
  });

  it("old password is invalidated in both cases", async () => {
    const user = await newUser();
    const now = new Date("2026-08-17T09:00:00.000Z");

    await Promise.all([
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "password-one-1234" },
      ),
      changePassword(
        { db: testDb, now },
        { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "password-two-1234" },
      ),
    ]);

    const oldLogin = await login(
      { db: testDb, now, rateLimitKey: "10.0.0.30", sleep: noWait },
      { email: "manager@example.test", password: OLD_PASSWORD },
    );

    expect(oldLogin.ok).toBe(false);
  });
});
