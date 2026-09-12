import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  RATE_LIMIT_MAX_REQUESTS,
} from "@/server/auth/config";
import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { findActiveSession } from "@/server/auth/session";

import { createOrgUnit, createUser, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const PASSWORD = "correct-password-123";

// Delay rule is tested separately (lockout.test.ts); here we pass through without waiting
// so that the login flow itself can be tested quickly.
const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function newUserWithPassword() {
  const unit = await createOrgUnit();
  return createUserWithPassword(unit.id, PASSWORD, {
    email: "manager@example.test",
  });
}

function attempt(password: string, now: Date = NOW, key = "10.0.0.1") {
  return login(
    { db: testDb, now, rateLimitKey: key, sleep: noWait },
    { email: "manager@example.test", password },
  );
}

describe("successful login", () => {
  it("correct password opens session", async () => {
    const user = await newUserWithPassword();

    const result = await attempt(PASSWORD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.userId).toBe(user.id);
    expect(await findActiveSession(testDb, result.session.token, NOW)).not.toBeNull();
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).toEqual(NOW);
  });

  it("failed attempt counter resets on successful login", async () => {
    const user = await newUserWithPassword();

    await attempt("wrong-password");
    await attempt(PASSWORD);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(0);
  });
});

describe("failed login", () => {
  it("wrong password is rejected and counter increments", async () => {
    const user = await newUserWithPassword();

    const result = await attempt("wrong-password");

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).toBeNull();
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedLoginCount).toBe(1);
  });

  it("unregistered email receives the same response as wrong password", async () => {
    await newUserWithPassword();

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "nonexistent@example.test", password: PASSWORD },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("deactivated user cannot log in", async () => {
    const user = await newUserWithPassword();
    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    expect(await attempt(PASSWORD)).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("user without password set cannot log in", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "passwordless@example.test" });

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "passwordless@example.test", password: PASSWORD },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("delay is applied on each failure and duration grows", async () => {
    await newUserWithPassword();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    for (let i = 0; i < 3; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep },
        { email: "manager@example.test", password: "wrong-password" },
      );
    }

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([0, 200, 400]);
  });
});

describe("account lockout", () => {
  it(`account locks on attempt ${MAX_FAILED_ATTEMPTS}`, async () => {
    const user = await newUserWithPassword();

    let result = await attempt("wrong-password");
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i += 1) {
      result = await attempt("wrong-password");
    }

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("locked");

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.lockedUntil).not.toBeNull();
  });

  it("correct password is also rejected while locked", async () => {
    await newUserWithPassword();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await attempt("wrong-password");
    }

    const result = await attempt(PASSWORD);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("locked");
  });

  it("correct password works after lock expires", async () => {
    await newUserWithPassword();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await attempt("wrong-password");
    }

    const afterLock = new Date(NOW.getTime() + (LOCKOUT_MINUTES + 1) * 60_000);
    const result = await attempt(PASSWORD, afterLock);

    expect(result.ok).toBe(true);
  });
});

describe("rate limiting", () => {
  // Attempt is made with unregistered email: what is measured here is not account lockout,
  // but client-based rate limiting.
  async function floodFrom(key: string) {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: key, sleep: noWait },
        { email: "nonexistent@example.test", password: "wrong-password" },
      );
    }
  }

  it("excessive attempts from same client are rejected", async () => {
    await newUserWithPassword();
    await floodFrom("10.0.0.9");

    const result = await attempt(PASSWORD, NOW, "10.0.0.9");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("one client's limit does not block another's login", async () => {
    await newUserWithPassword();
    await floodFrom("10.0.0.9");

    const result = await attempt(PASSWORD, NOW, "10.0.0.10");
    expect(result.ok).toBe(true);
  });
});

// Tests added after audit (17.08.2026).
describe("audit fixes", () => {
  it("concurrent failed attempts do not lose counter and lockout triggers", async () => {
    const user = await newUserWithPassword();

    // Concurrent attempts: if counter was read and written back, all would see same old
    // value and account would never lock (finding 6).
    await Promise.all(
      Array.from({ length: MAX_FAILED_ATTEMPTS }, (_, i) =>
        attempt("wrong-password", NOW, `10.0.1.${i}`),
      ),
    );

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(credential.failedLoginCount).toBe(MAX_FAILED_ATTEMPTS);
    expect(credential.lockedUntil).not.toBeNull();

    const afterwards = await attempt(PASSWORD, NOW, "10.0.2.1");
    expect(afterwards.ok).toBe(false);
    if (afterwards.ok) return;
    expect(afterwards.reason).toBe("locked");
  });

  it("attempts targeting single account cannot be sustained by changing client", async () => {
    await newUserWithPassword();

    // Different client IP on each attempt: client counter resets but account
    // counter continues accumulating (finding 7).
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await attempt("wrong-password", NOW, `10.9.9.${i}`);
    }

    const result = await attempt("wrong-password", NOW, "10.9.8.1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("exponential delay is also applied to unregistered email", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    for (let i = 0; i < 3; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep },
        { email: "nonexistent@example.test", password: "wrong-password" },
      );
    }

    // Not applying delay at all would give away that email is unregistered (finding 8).
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([0, 200, 400]);
  });
});

// "Remember me" (product owner requirement, 21.08.2026).
//
// Core rule being tested: this option **only extends session duration**.
// Lockout, rate limiting, and session revocation on password change must
// function identically — otherwise "remember me" silently becomes a security relaxation.
describe("remember me", () => {
  async function setDays(days: number) {
    await testDb.systemSetting.upsert({
      where: { key: "remember_me_days" },
      create: { key: "remember_me_days", value: String(days), description: "test" },
      update: { value: String(days) },
    });
  }

  it("session gets normal lifetime when unchecked", async () => {
    const user = await newUserWithPassword();
    await setDays(30);

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "remember-me-1", sleep: noWait },
      { email: user.email, password: PASSWORD },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Default 12 hours; must not exceed 24 hours.
    const hours = (result.session.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("session lasts as many days as set when checked", async () => {
    const user = await newUserWithPassword();
    await setDays(30);

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "remember-me-2", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const days = (result.session.expiresAt.getTime() - NOW.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("checked box is ignored if setting is 0", async () => {
    const user = await newUserWithPassword();
    await setDays(0);

    // Client-sent value is untrusted: form can be submitted manually even without checkbox.
    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "remember-me-3", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hours = (result.session.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("long session is still revoked on password change", async () => {
    const user = await newUserWithPassword();
    await setDays(30);

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "remember-me-4", sleep: noWait },
      { email: user.email, password: PASSWORD, remember: true },
    );
    if (!result.ok) throw new Error("login failed");

    // When password changes, credential version advances and old session dies.
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { version: { increment: 1 } },
    });

    const session = await findActiveSession(testDb, result.session.token, NOW);
    expect(session).toBeNull();
  });
});
