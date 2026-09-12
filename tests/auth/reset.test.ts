import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/server/auth/password";
import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import {
  issueResetToken,
  RESET_TOKEN_TTL_MS,
  verifyResetToken,
} from "@/server/auth/reset-token";
import { createSession } from "@/server/auth/session";
import { createUser } from "@/server/users/create";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Password reset (§15.3): single-use and time-limited token, all sessions revoked on success.
// Token is not kept in a separate table; bound to credential version — this is where "single-use"
// property comes from.

const SECRET = "test-secret-key-of-at-least-thirty-two-chars";
const NOW = new Date("2026-08-17T09:00:00.000Z");
const OLD_PASSWORD = "old-password-1234";
const NEW_PASSWORD = "new-password-5678";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUser(email = "user@example.test") {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const result = await createUser(testDb, {
    fullName: "Test User",
    email,
    orgUnitId: unit.id,
    isUnitManager: false,
    isSystemAdmin: false,
    writesActivities: true,
    initialPassword: OLD_PASSWORD,
  });
  if (!result.ok) throw new Error("setup");
  return result.user;
}

async function getToken(userId: string): Promise<string> {
  const queue = await testDb.notificationQueue.findFirstOrThrow({
    where: { userId, eventType: "password_reset" },
  });
  const payload = queue.payload as { token: string };
  return payload.token;
}

describe("token verification", () => {
  const USER = "11111111-1111-4111-8111-111111111111";

  it("issued token is verified", () => {
    const token = issueResetToken(USER, 3, NOW, SECRET);

    expect(verifyResetToken(token, NOW, SECRET)).toEqual({
      ok: true,
      userId: USER,
      credentialVersion: 3,
    });
  });

  it("expired token is rejected", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const after = new Date(NOW.getTime() + RESET_TOKEN_TTL_MS + 1);

    expect(verifyResetToken(token, after, SECRET)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("still accepted at the very last valid moment", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const rightOnTime = new Date(NOW.getTime() + RESET_TOKEN_TTL_MS);

    expect(verifyResetToken(token, rightOnTime, SECRET).ok).toBe(true);
  });

  it("token signed with different key is rejected", () => {
    const token = issueResetToken(USER, 0, NOW, "other-key-at-least-thirty-two-chars");

    expect(verifyResetToken(token, NOW, SECRET)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("tampered token is rejected", () => {
    const token = issueResetToken(USER, 0, NOW, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    // Body is swapped with another user's ID, signature left unchanged.
    const fakeBody = Buffer.from(
      JSON.stringify({
        userId: "22222222-2222-4222-8222-222222222222",
        version: 0,
        expiresAtMs: NOW.getTime() + RESET_TOKEN_TTL_MS,
      }),
    ).toString("base64url");

    expect(verifyResetToken(`${fakeBody}.${signature}`, NOW, SECRET).ok).toBe(false);
  });

  it("malformed formats are rejected", () => {
    for (const malformed of ["", "abc", "abc.def", ".", "e30.unexpected"]) {
      expect(verifyResetToken(malformed, NOW, SECRET).ok).toBe(false);
    }
  });
});

describe("reset request", () => {
  it("token is queued for registered user", async () => {
    const user = await setupUser();

    const result = await requestPasswordReset(testDb, user.email, NOW, SECRET);

    expect(result.issued).toBe(true);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue).toHaveLength(1);
    expect(queue[0].eventType).toBe("password_reset");
    expect(queue[0].userId).toBe(user.id);
  });

  it("unregistered email leaves no trace", async () => {
    await setupUser();

    const result = await requestPasswordReset(
      testDb,
      "unregistered@example.test",
      NOW,
      SECRET,
    );

    expect(result.issued).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("token is not sent to deactivated user", async () => {
    const user = await setupUser();
    await testDb.user.update({ where: { id: user.id }, data: { isActive: false } });

    const result = await requestPasswordReset(testDb, user.email, NOW, SECRET);

    expect(result.issued).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("uppercase email is also found", async () => {
    const user = await setupUser("user@example.test");

    const result = await requestPasswordReset(
      testDb,
      "  USER@EXAMPLE.TEST  ",
      NOW,
      SECRET,
    );

    expect(result.issued).toBe(true);
    expect(user.email).toBe("user@example.test");
  });

  it("repeated requests do not become email spam", async () => {
    const user = await setupUser();

    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);

    // Single record for the same generation: idempotency key carries the generation.
    expect(await testDb.notificationQueue.count()).toBe(1);
  });
});

describe("applying reset", () => {
  it("password changes and verifies with new password", async () => {
    const user = await setupUser();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    const result = await resetPassword(testDb, token, NEW_PASSWORD, NOW, SECRET);

    expect(result.ok).toBe(true);
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(credential.passwordHash, OLD_PASSWORD)).toBe(false);
  });

  it("all sessions are revoked on success (§15.3)", async () => {
    const user = await setupUser();
    await createSession(testDb, user.id, NOW);
    await createSession(testDb, user.id, NOW);
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    const result = await resetPassword(testDb, token, NEW_PASSWORD, NOW, SECRET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revokedSessionCount).toBe(2);
    expect(
      await testDb.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("same token cannot be used a second time", async () => {
    const user = await setupUser();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    expect((await resetPassword(testDb, token, NEW_PASSWORD, NOW, SECRET)).ok).toBe(
      true,
    );

    const second = await resetPassword(
      testDb,
      token,
      "other-password-9999",
      NOW,
      SECRET,
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("used_token");

    // Second attempt must not have changed password.
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, NEW_PASSWORD)).toBe(true);
  });

  it("expired token does not change password", async () => {
    const user = await setupUser();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    const result = await resetPassword(
      testDb,
      token,
      NEW_PASSWORD,
      new Date(NOW.getTime() + RESET_TOKEN_TTL_MS + 1),
      SECRET,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired_token");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, OLD_PASSWORD)).toBe(true);
  });

  it("token becomes invalid if another password change intervenes", async () => {
    const user = await setupUser();
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    // User changed password via another path: credential version advanced.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const result = await resetPassword(testDb, token, NEW_PASSWORD, NOW, SECRET);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("used_token");
  });

  it("reset also clears account lockout", async () => {
    const user = await setupUser();
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: {
        failedLoginCount: 10,
        lockedUntil: new Date(NOW.getTime() + 900_000),
      },
    });
    await requestPasswordReset(testDb, user.email, NOW, SECRET);
    const token = await getToken(user.id);

    await resetPassword(testDb, token, NEW_PASSWORD, NOW, SECRET);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.lockedUntil).toBeNull();
    expect(credential.failedLoginCount).toBe(0);
  });

  it("password cannot be changed with bogus token", async () => {
    const user = await setupUser();

    const result = await resetPassword(
      testDb,
      "bogus.token",
      NEW_PASSWORD,
      NOW,
      SECRET,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_token");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, OLD_PASSWORD)).toBe(true);
  });
});
