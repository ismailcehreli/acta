import { describe, expect, it } from "vitest";

import {
  DIGEST_HOUR,
  isDigestDue,
  isExhausted,
  isRetryDue,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from "@/server/notifications/schedule";

// Dispatch decision logic in pure functions; tested with mock timestamps (§12.3).

const NOW = new Date("2026-08-17T09:00:00.000Z");

describe("exponential backoff retry", () => {
  it("never-attempted notification does not wait", () => {
    expect(isRetryDue({ attemptCount: 0, lastAttemptAt: null }, NOW)).toBe(true);
  });

  it("wait delay increases after each attempt", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      const record = { attemptCount: attempt, lastAttemptAt: NOW };

      expect(
        isRetryDue(record, new Date(NOW.getTime() + delay - 1)),
        `Early dispatch after attempt ${attempt}`,
      ).toBe(false);
      expect(isRetryDue(record, new Date(NOW.getTime() + delay))).toBe(true);
    }
  });

  it("retry delay values are strictly increasing", () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i += 1) {
      expect(RETRY_DELAYS_MS[i]).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]);
    }
  });

  it("gives up after 5 attempts", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(isExhausted(4)).toBe(false);
    expect(isExhausted(5)).toBe(true);
    expect(
      isRetryDue(
        { attemptCount: MAX_ATTEMPTS, lastAttemptAt: NOW },
        new Date(NOW.getTime() + 10 * 24 * 3_600_000),
      ),
    ).toBe(false);
  });
});

describe("daily digest timing", () => {
  // Company time zone is Europe/Istanbul (UTC+3): 15:00 UTC = 18:00 Istanbul.
  const digestTime = new Date("2026-08-17T15:00:00.000Z");

  it("does not send before digest hour", () => {
    expect(isDigestDue(new Date("2026-08-17T14:59:00.000Z"), null)).toBe(false);
  });

  it("sends when digest hour arrives and not already sent today", () => {
    expect(isDigestDue(digestTime, null)).toBe(true);
  });

  it("does not send a second time on the same day", () => {
    const sentToday = new Date("2026-08-17T15:01:00.000Z");

    expect(isDigestDue(new Date("2026-08-17T20:00:00.000Z"), sentToday)).toBe(
      false,
    );
  });

  it("sends again the next day", () => {
    const sentYesterday = new Date("2026-08-17T15:01:00.000Z");

    expect(isDigestDue(new Date("2026-08-18T15:00:00.000Z"), sentYesterday)).toBe(
      true,
    );
  });

  it("calculates day boundary in company time zone", () => {
    // 17 Aug 21:30 UTC = 18 Aug 00:30 Istanbul: new day started but digest hour (18:00) not yet reached
    expect(isDigestDue(new Date("2026-08-17T21:30:00.000Z"), null)).toBe(false);
    expect(DIGEST_HOUR).toBe(18);
  });
});
