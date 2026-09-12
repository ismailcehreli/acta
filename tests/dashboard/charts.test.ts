import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { activityTrend, statusDistribution } from "@/server/dashboard/charts";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// TREND CHART DEPENDS ON COMPANY WORK CALENDAR (audit 2026-08-21, finding 13).
//
// `activityTrend` was taking working day definitions from hardcoded Saturday-Sunday logic,
// without reading the company's work calendar (§12.1).

const NOW = new Date("2026-08-22T12:00:00.000Z"); // Saturday

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  const user = await createUser(root.id, { email: "user@example.test" });
  return { root, user };
}

/** Sets up company work calendar; falls back to weekday defaults if empty. */
async function setupCalendar(workingDays: number[]) {
  await testDb.workCalendar.upsert({
    where: { id: 1 },
    create: { id: 1, workingDays, workStartMinute: 8 * 60, workEndMinute: 17 * 60 },
    update: { workingDays },
  });
}

function viewer(id: string) {
  return { id, isSystemAdmin: false };
}

describe("working day definition comes from settings", () => {
  it("includes Saturday in average when company works on Saturday", async () => {
    const { user } = await setup();
    // Only Saturday is a workday.
    await setupCalendar([6]);

    await createActivity(user, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-22T00:00:00.000Z"), // Saturday
    });

    const trend = await activityTrend(testDb, viewer(user.id), [], 2, NOW);

    expect(trend.total).toBe(1);
    expect(trend.workdayAverage).toBe(1);
  });

  it("official holiday falling on weekday is not counted as working day", async () => {
    const { user } = await setup();
    await setupCalendar([1, 2, 3, 4, 5]);

    // August 20, 2026 Thursday; marked as holiday.
    await testDb.holiday.create({
      data: { date: new Date("2026-08-20T00:00:00.000Z"), description: "Holiday" },
    });

    // Activity on Wednesday August 19; August 20 is empty.
    await createActivity(user, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });

    const trend = await activityTrend(
      testDb,
      viewer(user.id),
      [],
      4,
      new Date("2026-08-21T12:00:00.000Z"), // Friday
    );

    // 18, 19, 20, 21 -> excluding holiday 20 leaves 3 workdays, only 1 of which has records.
    expect(trend.emptyWorkdays).toBe(2);
  });

  it("falls back to weekday defaults when no calendar record exists", async () => {
    const { user } = await setup();

    await createActivity(user, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"), // Friday
    });

    const trend = await activityTrend(
      testDb,
      viewer(user.id),
      [],
      2,
      new Date("2026-08-22T12:00:00.000Z"), // Saturday
    );

    // 21 Friday (workday) + 22 Saturday (non-workday) -> denominator 1.
    expect(trend.workdayAverage).toBe(1);
  });
});

describe("chart does not leak beyond visibility scope", () => {
  it("does not include another user's activity in total", async () => {
    const root = await createOrgUnit({ name: "Acta HQ" });
    const user1 = await createUser(root.id, { email: "one@example.test" });
    const user2 = await createUser(root.id, { email: "two@example.test" });

    await createActivity(user2, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });

    const trend = await activityTrend(testDb, viewer(user1.id), [], 3, NOW);

    // Bar height is information: peer records cannot be included in tally.
    expect(trend.total).toBe(0);
  });

  it("management charts exclude manager's own activities", async () => {
    const root = await createOrgUnit({ name: "Acta HQ" });
    const manager = await createUser(root.id, {
      email: "manager@example.test",
      isUnitManager: true,
    });
    const worker = await createUser(root.id, { email: "worker@example.test" });

    await createActivity(manager, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });
    await createActivity(worker, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });

    const subordinates = [worker.id];
    const trend = await activityTrend(
      testDb,
      viewer(manager.id),
      subordinates,
      3,
      NOW,
      { managedOnly: true },
    );
    const statuses = await statusDistribution(
      testDb,
      viewer(manager.id),
      subordinates,
      new Date("2026-08-17T00:00:00.000Z"),
      { managedOnly: true },
    );

    expect(trend.total).toBe(1);
    expect(statuses).toEqual([{ status: "APPROVED", count: 1 }]);
  });
});

describe("cancellation and rejection excluded from trend line (decision 2026-09-03)", () => {
  it("cancelled and rejected records not counted in trend, but appear in distribution", async () => {
    const root = await createOrgUnit({ name: "Acta HQ" });
    const manager = await createUser(root.id, {
      email: "manager@example.test",
      isUnitManager: true,
    });
    const user = await createUser(root.id, { email: "record@example.test" });
    const day = new Date("2026-08-21T00:00:00.000Z");
    const reason = await createApprovalReason("REJECTED");

    await createActivity(user, { approvalStatus: "APPROVED", activityDate: day });
    await createActivity(user, { approvalStatus: "CANCELLED", activityDate: day });
    await createActivity(user, {
      approvalStatus: "REJECTED",
      activityDate: day,
      approverId: manager.id,
      approvalReasonId: reason.id,
      approvalReasonKind: "REJECTED",
    });

    const trend = await activityTrend(testDb, viewer(user.id), [], 3, NOW);
    const statuses = await statusDistribution(
      testDb,
      viewer(user.id),
      [],
      new Date("2026-08-17T00:00:00.000Z"),
    );

    expect(trend.total).toBe(1);
    expect(statuses.reduce((sum, slice) => sum + slice.count, 0)).toBe(3);
  });
});
