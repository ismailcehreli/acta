import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Two closing workers may race on the same period (audit 25.08.2026, P8-7).
//
// "Exists?" check and `create` were separate operations: both workers saw empty
// and attempted to insert the same `(userId, periodStart)` row, causing one to fail
// the entire call with a `P2002` unique constraint error.
// During rolling deployments old and new workers run concurrently.
//
// Expected behavior: both finish without error, leaving a single period and single fact set.

// Closing runs after retroactive entry window closes (P8-R2-2):
// with default settings July 31 entries can still be added on August 1.
const CLOSING_DATE = new Date(Date.UTC(2026, 7, 3, 6, 0, 0));

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("concurrent closing", () => {
  it("both workers finish without error when closing same period", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const author = await createUser(unit.id, { fullName: "Worker Kadir" });
    for (const day of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(author, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    // Two distinct connections: sharing the same client would mask the race.
    const secondClient = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });

    try {
      const results = await Promise.allSettled([
        closeScorePeriod(testDb, CLOSING_DATE),
        closeScorePeriod(secondClient, CLOSING_DATE),
      ]);

      const errors = results.flatMap((s) =>
        s.status === "rejected" ? [String(s.reason)] : [],
      );
      expect(errors, `closing errored: ${errors.join(" · ")}`).toEqual([]);

      // Single period, single fact set.
      const periodCount = await testDb.userScorePeriod.count({
        where: { userId: author.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      });
      expect(periodCount).toBe(1);

      const factCount = await testDb.userScorePeriodFact.count({
        where: { userId: author.id, kind: "WRITTEN" },
      });
      expect(factCount).toBe(3);

      // Only one person in setup: one writes, other skips. Total written should be 1.
      const totalWritten = results.flatMap((s) =>
        s.status === "fulfilled" ? [s.value.written] : [],
      );
      expect(totalWritten.reduce((a, b) => a + b, 0)).toBe(1);
    } finally {
      await secondClient.$disconnect();
    }
  });
});
