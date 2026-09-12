import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  acquireScoreClosureLock,
  acquireScoreMutationLock,
} from "@/server/scoring/recalculation";

import { testDatabaseUrl } from "../helpers/test-db";

// P8-R4-2 — activity mutations do not exclude each other; only closing stops
// them for a brief period. Real PostgreSQL advisory lock behavior is measured
// across multiple connections; a single connection masks lock wait states.

const first = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const second = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const third = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const TEST_LOCK_KEY = "acta:score_closure:shared_lock_test";

afterAll(async () => {
  await Promise.all([first.$disconnect(), second.$disconnect(), third.$disconnect()]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("score closing shared lock", () => {
  it("two regular mutations do not block each other, closing excludes them", async () => {
    const firstLocked = deferred();
    const releaseFirst = deferred();
    const firstMutation = first.$transaction(async (tx) => {
      await acquireScoreMutationLock(tx, TEST_LOCK_KEY);
      firstLocked.resolve();
      await releaseFirst.promise;
    });
    await firstLocked.promise;
    const secondMutation = second.$transaction((tx) =>
      acquireScoreMutationLock(tx, TEST_LOCK_KEY),
    );
    const releaseClosure = deferred();
    let closeMutation: Promise<unknown> | null = null;

    try {
      // In old exclusive locking, this transaction would not return until the first mutation released.
      // In shared mode, it should complete immediately.
      await Promise.race([
        secondMutation,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("second mutation waited")), 500)),
      ]);

      const closureEntered = deferred();
      closeMutation = third.$transaction(async (tx) => {
        await acquireScoreClosureLock(tx, TEST_LOCK_KEY);
        closureEntered.resolve();
        await releaseClosure.promise;
      });

      // Exclusive closure cannot proceed until active shared mutation finishes.
      await expect(
        Promise.race([
          closureEntered.promise.then(() => "entered"),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 120)),
        ]),
      ).resolves.toBe("waiting");

      releaseFirst.resolve();
      await firstMutation;
      await expect(closureEntered.promise).resolves.toBeUndefined();

      const afterClosureMutation = second.$transaction((tx) =>
        acquireScoreMutationLock(tx, TEST_LOCK_KEY),
      );
      // Once closure acquires exclusive lock, new normal writes cannot intervene
      // between the scorecard and queue decision.
      await expect(
        Promise.race([
          afterClosureMutation.then(() => "entered"),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 120)),
        ]),
      ).resolves.toBe("waiting");

      releaseClosure.resolve();
      await closeMutation;
      await afterClosureMutation;
    } finally {
      releaseFirst.resolve();
      releaseClosure.resolve();
      await firstMutation;
      await secondMutation;
      await closeMutation;
    }
  });
});
