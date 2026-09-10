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

describe("artan gecikme", () => {
  it("ilk denemede gecikme yoktur", () => {
    expect(loginDelayMs(0)).toBe(0);
  });

  it("her hatada ikiye katlanır", () => {
    expect(loginDelayMs(1)).toBe(200);
    expect(loginDelayMs(2)).toBe(400);
    expect(loginDelayMs(3)).toBe(800);
  });

  it("tavanı aşmaz", () => {
    expect(loginDelayMs(50)).toBe(DELAY_MAX_MS);
  });
});

describe("kilitlenme eşiği", () => {
  it(`${MAX_FAILED_ATTEMPTS} denemeden önce kilitlenmez`, () => {
    expect(isLockThresholdReached(MAX_FAILED_ATTEMPTS - 1)).toBe(false);
  });

  it(`${MAX_FAILED_ATTEMPTS}. denemede kilitlenir`, () => {
    expect(isLockThresholdReached(MAX_FAILED_ATTEMPTS)).toBe(true);
  });
});

describe("kilit süresi", () => {
  it("kilit, şimdiden itibaren tanımlı süre kadardır", () => {
    expect(lockUntil(NOW).getTime() - NOW.getTime()).toBe(
      LOCKOUT_MINUTES * 60_000,
    );
  });

  it("süresi geçmemiş kilit etkilidir", () => {
    expect(isLocked(new Date("2026-08-17T09:05:00.000Z"), NOW)).toBe(true);
  });

  it("süresi geçmiş kilit etkisizdir", () => {
    expect(isLocked(new Date("2026-08-17T08:59:00.000Z"), NOW)).toBe(false);
  });

  it("kilit yoksa engel yoktur", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });
});
