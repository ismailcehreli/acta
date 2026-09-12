import { beforeEach, describe, expect, it } from "vitest";

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/server/auth/config";
import {
  clearFailures,
  peekFailures,
  pruneRateLimits,
  recordFailure,
  resetRateLimits,
  trackedKeyCount,
} from "@/server/auth/rate-limit";

// What is counted is **failed attempts**, not request count: the company is behind a single
// external IP address (§15.5) and counting every request would mean colleagues logging in
// at the same time locking each other out.

const START = 1_000_000;
const KEY = "account:manager@example.test";

beforeEach(() => {
  resetRateLimits();
});

describe("failed attempt counter", () => {
  it("no block when there are no attempts", () => {
    expect(peekFailures(KEY, START)).toEqual({
      blocked: false,
      count: 0,
      retryAfterMs: 0,
    });
  });

  it("reading does not increment counter", () => {
    recordFailure(KEY, START);

    peekFailures(KEY, START);
    peekFailures(KEY, START);

    expect(peekFailures(KEY, START).count).toBe(1);
  });

  it("allows up to limit, blocks at limit", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS - 1; i += 1) {
      recordFailure(KEY, START);
    }
    expect(peekFailures(KEY, START).blocked).toBe(false);

    recordFailure(KEY, START);
    expect(peekFailures(KEY, START).blocked).toBe(true);
    expect(peekFailures(KEY, START).retryAfterMs).toBe(RATE_LIMIT_WINDOW_MS);
  });

  it("counter resets when window expires", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }

    const afterWindow = START + RATE_LIMIT_WINDOW_MS + 1;
    expect(peekFailures(KEY, afterWindow).blocked).toBe(false);
  });

  it("successful login clears counter", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }
    expect(peekFailures(KEY, START).blocked).toBe(true);

    clearFailures(KEY);

    expect(peekFailures(KEY, START).blocked).toBe(false);
  });

  it("counter of one key does not affect another", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      recordFailure(KEY, START);
    }

    expect(peekFailures("account:other@example.test", START).blocked).toBe(false);
  });
});

describe("memory management", () => {
  it("expired records are cleaned up when opening new window", () => {
    for (let i = 0; i < 50; i += 1) {
      recordFailure(`client-${i}`, START);
    }
    expect(trackedKeyCount()).toBe(50);

    recordFailure("new-client", START + RATE_LIMIT_WINDOW_MS + 1);

    expect(trackedKeyCount()).toBe(1);
  });

  it("key count cannot exceed upper bound", () => {
    for (let i = 0; i < 10_200; i += 1) {
      recordFailure(`client-${i}`, START);
    }

    expect(trackedKeyCount()).toBeLessThanOrEqual(10_000);
  });

  it("expired records can also be pruned manually", () => {
    recordFailure(KEY, START);
    pruneRateLimits(START + RATE_LIMIT_WINDOW_MS + 1);

    expect(trackedKeyCount()).toBe(0);
  });
});
