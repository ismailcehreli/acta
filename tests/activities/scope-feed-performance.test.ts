import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listScopeActivities } from "@/server/activities/scope-feed";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §18.4 acceptance criterion: with 12 months of data, main screen must open
// in under two seconds. Audit flagged that this was never benchmarked
// (2026-08-18, PHASE 4 finding 11) — tests were running with just two records.
//
// Measurement is not an absolute hardware performance promise: varies per machine.
// Goal is to verify early that queries do not scale catastrophically with row count.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const USER_COUNT = 30;
const DAYS_PER_USER = 250;
const TIME_LIMIT_MS = 2_000;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupTwelveMonthCompany() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const director = await createUser(root.id, {
    fullName: "Director",
    isUnitManager: true,
  });

  const departments = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      createOrgUnit({ name: `Department ${i + 1}`, parentId: root.id }),
    ),
  );

  const authors = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const unit = departments[i % departments.length];
    authors.push(
      await createUser(unit.id, {
        fullName: `User ${i + 1}`,
        // Each department has a single manager; others are members.
        isUnitManager: i < departments.length,
      }),
    );
  }

  for (const author of authors) {
    await testDb.activity.createMany({
      data: Array.from({ length: DAYS_PER_USER }, (_, day) => ({
        authorId: author.id,
        authorOrgUnitId: author.orgUnitId,
        activityDate: new Date(NOW.getTime() - day * 86_400_000),
        title: `Activity ${day + 1}`,
        description: "Summary of work done during the day.",
        approvalStatus: "APPROVED" as const,
        createdAt: new Date(NOW.getTime() - day * 86_400_000),
        updatedAt: NOW,
      })),
    });
  }

  return { director, total: USER_COUNT * DAYS_PER_USER };
}

describe("scope feed with 12 months of data", () => {
  it("opens entire company view under threshold limit", async () => {
    const { director, total } = await setupTwelveMonthCompany();
    expect(await testDb.activity.count()).toBe(total);

    const start = performance.now();
    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 50 },
    );
    const elapsed = performance.now() - start;

    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    // Benchmark output logged: staying below threshold is necessary, and margin should be visible.
    console.info(
      `[benchmark] first page across ${total} records: ${elapsed.toFixed(0)} ms`,
    );
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
  }, 120_000);

  it("opens deep page under threshold limit", async () => {
    const { director } = await setupTwelveMonthCompany();

    // Deep pagination accessed via cursor; offset-based queries would degrade with depth.
    let cursor = null;
    for (let i = 0; i < 20; i += 1) {
      const page = await listScopeActivities(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { period: "all" },
        NOW,
        { limit: 50, cursor },
      );
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    const start = performance.now();
    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 50, cursor },
    );
    const elapsed = performance.now() - start;

    console.info(`[benchmark] page near 1000th record: ${elapsed.toFixed(0)} ms`);
    expect(page.items.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
  }, 120_000);
});
