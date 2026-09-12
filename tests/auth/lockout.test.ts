import { describe, expect, it } from "vitest";

import {
  DELAY_MAX_MS,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from "@/server/auth/config";
import {
  isLockThresholdReached,
  isLocked,
  lockUntil,
  loginDelayMs,
} from "@/server/auth/lockout";

const NOW = new Date("2026-08-17T09:00:00.000Z");

describe("exponential backoff delay", () => {
  it("no delay on first attempt", () => {
    expect(loginDelayMs(0)).toBe(0);
  });

  it("doubles on each failure", () => {
    expect(loginDelayMs(1)).toBe(200);
    expect(loginDelayMs(2)).toBe(400);
    expect(loginDelayMs(3)).toBe(800);
  });

  it("does not exceed ceiling", () => {
    expect(loginDelayMs(50)).toBe(DELAY_MAX_MS);
  });
});

describe("lockout threshold", () => {
  it(`does not lock before ${MAX_FAILED_ATTEMPTS} attempts`, () => {
    expect(isLockThresholdReached(MAX_FAILED_ATTEMPTS - 1)).toBe(false);
  });

  it(`locks on attempt ${MAX_FAILED_ATTEMPTS}`, () => {
    expect(isLockThresholdReached(MAX_FAILED_ATTEMPTS)).toBe(true);
  });
});

describe("lock duration", () => {
  it("lock lasts for defined duration from now", () => {
    expect(lockUntil(NOW).getTime() - NOW.getTime()).toBe(
      LOCKOUT_MINUTES * 60_000,
    );
  });

  it("unexpired lock is effective", () => {
    expect(isLocked(new Date("2026-08-17T09:05:00.000Z"), NOW)).toBe(true);
  });

  it("expired lock is inactive", () => {
    expect(isLocked(new Date("2026-08-17T08:59:00.000Z"), NOW)).toBe(false);
  });

  it("no block if no lock exists", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });
});
