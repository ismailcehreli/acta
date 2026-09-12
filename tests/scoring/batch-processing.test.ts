import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeScorePeriod,
  drainScorePeriodWork,
} from "@/server/scoring/close-period";
import { approveActivity } from "@/server/activities/approval";
import { createActivity as createActivityService } from "@/server/activities/write";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// P8-R4-1 — worker should not wait minutes for a single person-month correction.
// Each correction remains a separate transaction; batching only determines how many
// independent jobs are picked sequentially in the same round.

const CLOSING_DATE = new Date("2026-08-03T06:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function seedClosedUsers(count: number) {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
  const users = await Promise.all(Array.from(
    { length: count },
    (_, index) => createUser(unit.id, { fullName: `Employee ${index + 1}` }),
  ));

  for (const user of users) {
    await createActivity(user, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
  }
  await closeScorePeriod(testDb, CLOSING_DATE);

  await testDb.scoreRecalculationRequest.createMany({
    data: users.map((user) => ({
      userId: user.id,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      sourceType: "TEST_BATCH",
      sourceId: user.id,
      requestedAt: new Date("2026-08-10T09:00:00.000Z"),
    })),
  });

  return users;
}

describe("score recalculation batch processing", () => {
  it("processes 20 items in first round with default worker settings and remaining in second round", async () => {
    await seedClosedUsers(21);

    // No options provided: worker's `drainScorePeriodWork(prisma, now)` invocation
    // uses these exact defaults.
    const firstDrain = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T10:00:00.000Z"),
    );

    expect(firstDrain).toMatchObject({ processed: 20, written: 20, exhaustedItemBudget: true });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(1);

    const secondDrain = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T10:01:00.000Z"),
    );
    expect(secondDrain).toMatchObject({ processed: 1, written: 1, exhaustedItemBudget: false });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
  });

  it("late approval of a user outside scoring scope does not produce recalculation request", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({
      name: "Tooling Shop",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(unit.id, {
      fullName: "Shop Manager",
      isUnitManager: true,
    });
    const nonScoredUser = await createUser(unit.id, {
      fullName: "Non Scored Employee",
      isScored: false,
    });

    const created = await createActivityService(
      testDb,
      { id: nonScoredUser.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: "2026-07-15",
        title: "Activity pending approval",
        description: "Late approval queue test.",
        targetDepartmentIds: [],
      },
      new Date("2026-07-15T09:00:00.000Z"),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await closeScorePeriod(testDb, CLOSING_DATE);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: nonScoredUser.id } }),
    ).toBe(0);

    expect(
      (await approveActivity(testDb, manager.id, created.activity.id, new Date("2026-08-03T09:00:00.000Z"))).ok,
    ).toBe(true);
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { userId: nonScoredUser.id } }),
    ).toBe(0);
  });

  it("stale no-score-card request does not block valid request in queue", async () => {
    const [scoredUser] = await seedClosedUsers(1);
    const nonScoredUser = await createUser(scoredUser.orgUnitId, {
      fullName: "Legacy Queue Record",
      isScored: false,
    });

    // Directly create a legacy request left over from pre-migration or manual intervention:
    // selecting a user whose scorecard was never created.
    await testDb.scoreRecalculationRequest.createMany({
      data: [
        {
          userId: nonScoredUser.id,
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          sourceType: "LEGACY_NO_PERIOD",
          sourceId: nonScoredUser.id,
          requestedAt: new Date("2026-08-10T08:00:00.000Z"),
        },
      ],
    });

    const result = await drainScorePeriodWork(testDb, new Date("2026-08-10T10:00:00.000Z"));
    expect(result).toMatchObject({ processed: 2, written: 1 });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: scoredUser.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      }),
    ).toBe(2);
  });
});
