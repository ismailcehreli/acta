import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, requestChanges } from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendOverdueApprovalReminders } from "@/worker/reminders/overdue-approvals";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Overdue approval reminders test suite.
// 2026-08-17 is Monday; 2026-08-19 is Wednesday = 2 business days later.

const WRITTEN_AT = new Date("2026-08-17T09:00:00.000Z");
const TWO_BUSINESS_DAYS_LATER = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({
    name: "Tooling Department",
    parentId: root.id,
    requiresApproval: true,
  });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Tooling Worker" });

  return { manager, employee };
}

function formatDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function createPendingActivity(
  user: { id: string; orgUnitId: string },
  now: Date = WRITTEN_AT,
) {
  const result = await createActivity(
    testDb,
    { id: user.id, orgUnitId: user.orgUnitId, requiresApproval: true },
    {
      activityDate: formatDate(now),
      title: "Tooling maintenance",
      description: "Weekly maintenance completed.",
      targetDepartmentIds: [],
    },
    now,
  );
  if (!result.ok) throw new Error(`setup failed: ${result.message}`);
  return result.activity;
}

async function fetchReminders() {
  return testDb.notificationQueue.findMany({
    where: { eventType: NOTIFICATION_EVENTS.approvalOverdue },
  });
}

describe("overdue approval reminders", () => {
  it("enqueues reminder to approver when activity exceeds threshold", async () => {
    const { employee, manager } = await setupCompany();
    await createPendingActivity(employee);

    const result = await sendOverdueApprovalReminders(testDb, TWO_BUSINESS_DAYS_LATER);

    expect(result).toEqual({ overdue: 1, queued: 1 });
    const queue = await fetchReminders();
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe(manager.id);
  });

  it("does not send reminder before threshold elapses", async () => {
    const { employee } = await setupCompany();
    await createPendingActivity(employee);

    const result = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(result).toEqual({ overdue: 0, queued: 0 });
    expect(await fetchReminders()).toHaveLength(0);
  });

  it("respects threshold changes from system settings", async () => {
    const { employee } = await setupCompany();
    await createPendingActivity(employee);
    await saveSettings(testDb, {
      [SETTING_KEYS.pendingApprovalBusinessDays]: "1",
    });

    const result = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-18T09:00:00.000Z"),
    );

    expect(result.queued).toBe(1);
  });

  it("does not enqueue duplicate reminders for the same pending wait period", async () => {
    const { employee } = await setupCompany();
    await createPendingActivity(employee);

    await sendOverdueApprovalReminders(testDb, TWO_BUSINESS_DAYS_LATER);
    const second = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(second.overdue).toBe(1);
    expect(second.queued).toBe(0);
    expect(await fetchReminders()).toHaveLength(1);
  });

  it("does not send reminders for approved activities", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    await approveActivity(testDb, manager.id, activity.id, WRITTEN_AT);

    const result = await sendOverdueApprovalReminders(testDb, TWO_BUSINESS_DAYS_LATER);

    expect(result).toEqual({ overdue: 0, queued: 0 });
  });

  it("does not send reminder when changes have been requested", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: (await createApprovalReason("CHANGES_REQUESTED")).id },
      WRITTEN_AT,
    );

    const result = await sendOverdueApprovalReminders(testDb, TWO_BUSINESS_DAYS_LATER);

    expect(result).toEqual({ overdue: 0, queued: 0 });
  });

  it("resets waiting counter when author resubmits corrected activity", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: (await createApprovalReason("CHANGES_REQUESTED")).id },
      WRITTEN_AT,
    );

    await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: formatDate(TWO_BUSINESS_DAYS_LATER),
        title: "Tooling maintenance",
        description: "Early wear identified on mold #3.",
        targetDepartmentIds: [],
      },
      TWO_BUSINESS_DAYS_LATER,
    );

    expect(
      await sendOverdueApprovalReminders(testDb, TWO_BUSINESS_DAYS_LATER),
    ).toEqual({ overdue: 0, queued: 0 });

    const later = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );
    expect(later.queued).toBe(1);
  });

  it("excludes weekends from business day calculations", async () => {
    const { employee } = await setupCompany();
    await createPendingActivity(employee, new Date("2026-08-21T09:00:00.000Z"));

    const monday = await sendOverdueApprovalReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );

    expect(monday.queued).toBe(0);
  });
});
