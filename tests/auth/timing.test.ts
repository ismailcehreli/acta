import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Measuring password work with a fake function: the goal is not correctness,
// but to prove that different account states pay the **same** cost.
vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(async () => "fake-hash"),
  verifyPassword: vi.fn(async () => false),
}));

import { LOCKOUT_MINUTES } from "@/server/auth/config";
import { login } from "@/server/auth/login";
import { verifyPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/rate-limit";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Audit PHASE 2, finding 2: locked account was returning without paying any delay
// or password verification cost. Matching user-facing text is not enough — response
// time also leaks the "this email is registered and active" information.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  vi.mocked(verifyPassword).mockClear();
});

afterAll(async () => {
  await testDb.$disconnect();
});

interface Cost {
  sleepCalls: number[];
  verifyCalls: number;
}

async function measure(email: string, key: string): Promise<Cost> {
  const sleepCalls: number[] = [];
  vi.mocked(verifyPassword).mockClear();

  await login(
    {
      db: testDb,
      now: NOW,
      rateLimitKey: key,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    },
    { email, password: "tried-password" },
  );

  return { sleepCalls, verifyCalls: vi.mocked(verifyPassword).mock.calls.length };
}

describe("account statuses pay the same cost", () => {
  it("locked account and unregistered email experience same delay and hash work", async () => {
    const unit = await createOrgUnit();
    const user = await createUserWithPassword(unit.id, "password", {
      email: "locked@example.test",
    });
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: {
        failedLoginCount: 10,
        lockedUntil: new Date(NOW.getTime() + LOCKOUT_MINUTES * 60_000),
      },
    });

    const locked = await measure("locked@example.test", "10.0.0.1");
    const unregistered = await measure("nonexistent@example.test", "10.0.0.2");

    expect(locked.sleepCalls).toEqual(unregistered.sleepCalls);
    expect(locked.verifyCalls).toBe(unregistered.verifyCalls);
    // Both paths must actually execute a password verification.
    expect(locked.verifyCalls).toBeGreaterThan(0);
  });

  it("wrong password path also runs same number of hash jobs", async () => {
    const unit = await createOrgUnit();
    await createUserWithPassword(unit.id, "password", {
      email: "active@example.test",
    });

    const wrongPassword = await measure("active@example.test", "10.0.0.3");
    const unregistered = await measure("nonexistent2@example.test", "10.0.0.4");

    expect(wrongPassword.verifyCalls).toBe(unregistered.verifyCalls);
    expect(wrongPassword.sleepCalls).toEqual(unregistered.sleepCalls);
  });
});
