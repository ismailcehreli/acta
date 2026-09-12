import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  listScopeActivities,
} from "@/server/activities/scope-feed";
import { countOwnActivities, listOwnActivities } from "@/server/activities/read";
import { dashboardMetrics, personalDashboardMetrics } from "@/server/dashboard/metrics";
import { subordinateUserIds } from "@/server/authz/visibility";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function openQuestion(activityId: string, askerId: string, responsibleId: string) {
  return testDb.conversation.create({
    data: { activityId, askerId, responsibleId, status: "OPEN" },
  });
}

describe("dashboard metrics scope", () => {
  it("keeps personal and managed scope metrics completely distinct", async () => {
    const unit = await createOrgUnit({ name: "Production" });
    const manager = await createUser(unit.id, {
      fullName: "Unit Manager",
      isUnitManager: true,
    });
    const employee = await createUser(unit.id, { fullName: "Worker" });

    await createActivity(manager, {
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
    });
    await createActivity(employee, {
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
    });

    const personal = await personalDashboardMetrics(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const managed = await dashboardMetrics(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, manager.id),
      "week",
      NOW,
    );

    expect(personal.activities).toBe(1);
    expect(personal.contributors).toBe(1);
    expect(managed.activities).toBe(1);
    expect(managed.contributors).toBe(1);
  });

  it("excludes cancelled and rejected records from metric counters", async () => {
    const unit = await createOrgUnit({ name: "Production" });
    const manager = await createUser(unit.id, {
      fullName: "Unit Manager",
      isUnitManager: true,
    });
    const employee = await createUser(unit.id, { fullName: "Worker" });

    const day = new Date("2026-08-18T00:00:00.000Z");
    const reason = await createApprovalReason("REJECTED");

    await createActivity(manager, { activityDate: day });
    await createActivity(manager, { activityDate: day, approvalStatus: "CANCELLED" });

    await createActivity(employee, { activityDate: day });
    await createActivity(employee, { activityDate: day, approvalStatus: "CANCELLED" });
    await createActivity(employee, {
      activityDate: day,
      approvalStatus: "REJECTED",
      approverId: manager.id,
      approvalReasonId: reason.id,
      approvalReasonKind: "REJECTED",
    });

    const personal = await personalDashboardMetrics(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const employeePersonal = await personalDashboardMetrics(
      testDb,
      { id: employee.id, isSystemAdmin: false },
      "week",
      NOW,
    );
    const managed = await dashboardMetrics(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, manager.id),
      "week",
      NOW,
    );

    expect(personal.activities).toBe(1);
    expect(employeePersonal.activities).toBe(1);
    expect(managed.activities).toBe(1);
  });

  it("excludes users with only cancelled or rejected entries from contributor count", async () => {
    const unit = await createOrgUnit({ name: "Production" });
    const manager = await createUser(unit.id, {
      fullName: "Unit Manager",
      isUnitManager: true,
    });
    const employee = await createUser(unit.id, { fullName: "Worker" });

    const day = new Date("2026-08-18T00:00:00.000Z");
    await createActivity(employee, { activityDate: day, approvalStatus: "CANCELLED" });

    const managed = await dashboardMetrics(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      await subordinateUserIds(testDb, manager.id),
      "week",
      NOW,
    );

    expect(managed.activities).toBe(0);
    expect(managed.contributors).toBe(0);
  });

  it("counts activities with open questions once and matches list results", async () => {
    const unit = await createOrgUnit({ name: "Production" });
    const manager = await createUser(unit.id, {
      fullName: "Unit Manager",
      isUnitManager: true,
    });
    const employee = await createUser(unit.id, { fullName: "Worker" });
    const asker = await createUser(unit.id, { fullName: "Asker" });
    const secondAsker = await createUser(unit.id, { fullName: "Second Asker" });

    const selfQuestion = await createActivity(employee, { title: "Only self question" });
    await openQuestion(selfQuestion.id, manager.id, employee.id);

    const mixed = await createActivity(employee, { title: "Self and incoming question" });
    await openQuestion(mixed.id, manager.id, employee.id);
    await openQuestion(mixed.id, asker.id, employee.id);

    const twoIncoming = await createActivity(employee, { title: "Two incoming questions" });
    await openQuestion(twoIncoming.id, asker.id, employee.id);
    await openQuestion(twoIncoming.id, secondAsker.id, employee.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const subordinates = await subordinateUserIds(testDb, manager.id);
    const filters = { period: "all" as const, openQuestions: true };
    const [metrics, list, count] = await Promise.all([
      dashboardMetrics(testDb, viewer, subordinates, "week", NOW),
      listScopeActivities(testDb, viewer, filters, NOW, {
        managedOnly: true,
        subordinates,
      }),
      countScopeActivities(testDb, viewer, filters, NOW, {
        managedOnly: true,
        subordinates,
      }),
    ]);

    expect(metrics.openQuestions).toBe(2);
    expect(count).toBe(2);
    expect(list.items).toHaveLength(count);
    expect(new Set(list.items.map((item) => item.id))).toEqual(
      new Set([mixed.id, twoIncoming.id]),
    );
  });

  it("excludes self-asked questions from personal open question metric", async () => {
    const unit = await createOrgUnit({ name: "Production" });
    const employee = await createUser(unit.id, { fullName: "Worker" });
    const asker = await createUser(unit.id, { fullName: "Asker" });

    const selfQuestion = await createActivity(employee, { title: "Self question" });
    await openQuestion(selfQuestion.id, employee.id, asker.id);

    const incomingQuestion = await createActivity(employee, { title: "Incoming question" });
    await openQuestion(incomingQuestion.id, asker.id, employee.id);

    const viewer = { id: employee.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [metrics, list, count] = await Promise.all([
      personalDashboardMetrics(testDb, viewer, "week", NOW),
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(metrics.openQuestions).toBe(1);
    expect(list.map((item) => item.id)).toEqual([incomingQuestion.id]);
    expect(count).toBe(1);
  });
});
