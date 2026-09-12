import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { addHoliday, saveWorkCalendar } from "@/server/calendar/settings";
import { DEFAULT_WORK_CALENDAR } from "@/server/calendar/settings";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Missing activity reminder tests.
// Company timezone is Europe/Istanbul (UTC+3): 15:00 UTC = 18:00 Istanbul (after default 17:30 work end).

const AFTER_WORK_HOURS = new Date("2026-08-17T15:00:00.000Z"); // Monday 18:00
const DURING_WORK_HOURS = new Date("2026-08-17T09:00:00.000Z"); // Monday 12:00

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupTeam() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({ name: "Tooling Department", parentId: root.id });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Tooling Worker" });

  return { manager, employee, tooling };
}

async function createActivityEntry(
  author: { id: string; orgUnitId: string },
  day: string,
  approvalStatus: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title: "Title",
      description: "Description",
      approvalStatus,
    },
  });
}

describe("timing and triggers", () => {
  it("enqueues reminders after work hours on weekdays", async () => {
    await setupTeam();

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBe(2);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue).toHaveLength(2);
    expect(queue[0].eventType).toBe("no_activity_today");
  });

  it("does not trigger before work hours end", async () => {
    await setupTeam();

    const result = await sendMissingActivityReminders(testDb, DURING_WORK_HOURS);

    expect(result.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("does not trigger on weekends", async () => {
    await setupTeam();
    const saturday = new Date("2026-08-22T15:00:00.000Z");

    const result = await sendMissingActivityReminders(testDb, saturday);

    expect(result.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("does not trigger on public holidays", async () => {
    await setupTeam();
    await addHoliday(testDb, { date: "2026-08-17", description: "Test holiday" });

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedNotDue).toBe(true);
    expect(await testDb.notificationQueue.count()).toBe(0);
  });

  it("triggers on newly configured working days in calendar", async () => {
    await setupTeam();
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [1, 2, 3, 4, 5, 6],
    });
    const saturday = new Date("2026-08-22T15:00:00.000Z");

    const result = await sendMissingActivityReminders(testDb, saturday);

    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBeGreaterThan(0);
  });

  it("reads work end minute directly from calendar configuration", async () => {
    await setupTeam();
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workEndMinute: 20 * 60, // 20:00
    });

    expect((await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS)).skippedNotDue).toBe(
      true,
    );
    const late = new Date("2026-08-17T17:30:00.000Z");
    expect((await sendMissingActivityReminders(testDb, late)).skippedNotDue).toBe(false);
  });
});

describe("recipient filtering", () => {
  it("does not send reminder if user already logged activity today", async () => {
    const { employee } = await setupTeam();
    await createActivityEntry(employee, "2026-08-17");

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedHasActivity).toBe(1);
    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).not.toContain(employee.id);
  });

  it("does not treat yesterday's activity as fulfilling today's requirement", async () => {
    const { employee } = await setupTeam();
    await createActivityEntry(employee, "2026-08-16");

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.queued).toBe(2);
  });

  it("does not count cancelled activity as valid daily entry", async () => {
    const { employee } = await setupTeam();
    await createActivityEntry(employee, "2026-08-17", "CANCELLED");

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedHasActivity).toBe(0);
    expect(result.queued).toBe(2);
  });

  it("excludes users configured as not expected to write activities", async () => {
    const { employee } = await setupTeam();
    await testDb.user.update({
      where: { id: employee.id },
      data: { writesActivities: false },
    });

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).not.toContain(employee.id);
  });

  it("excludes users on approved absence period", async () => {
    const { manager, employee } = await setupTeam();
    await markNoActivityPeriod(
      testDb,
      manager.id,
      { userId: employee.id, startDate: "2026-08-17", endDate: "2026-08-21" },
      DURING_WORK_HOURS,
    );

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedNoActivityMark).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).not.toContain(employee.id);
  });

  it("does not stop reminders for requests still pending approval", async () => {
    const { employee } = await setupTeam();
    await testDb.noActivityPeriod.create({
      data: {
        userId: employee.id,
        startDate: new Date("2026-08-17T00:00:00.000Z"),
        endDate: new Date("2026-08-21T00:00:00.000Z"),
        note: "Pending request",
        markedById: employee.id,
        status: "PENDING",
      },
    });

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.skippedNoActivityMark).toBe(0);
    expect(result.queued).toBe(2);
    expect((await testDb.notificationQueue.findMany()).map((k) => k.userId)).toContain(
      employee.id,
    );
  });

  it("excludes deactivated users from reminders", async () => {
    const { employee } = await setupTeam();
    await testDb.user.update({
      where: { id: employee.id },
      data: { isActive: false },
    });

    const result = await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).not.toContain(employee.id);
  });

  it("sends reminder strictly to the individual user and not their manager", async () => {
    const { manager, employee } = await setupTeam();
    await createActivityEntry(manager, "2026-08-17");

    await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    const queue = await testDb.notificationQueue.findMany();
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe(employee.id);
  });
});

describe("once per day reminder constraint", () => {
  it("does not enqueue duplicate notifications on subsequent run on same day", async () => {
    await setupTeam();

    await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);
    const second = await sendMissingActivityReminders(
      testDb,
      new Date("2026-08-17T16:00:00.000Z"),
    );

    expect(second.queued).toBe(0);
    expect(await testDb.notificationQueue.count()).toBe(2);
  });

  it("triggers again on the next day", async () => {
    await setupTeam();
    await sendMissingActivityReminders(testDb, AFTER_WORK_HOURS);

    const nextDay = await sendMissingActivityReminders(
      testDb,
      new Date("2026-08-18T15:00:00.000Z"),
    );

    expect(nextDay.queued).toBe(2);
    expect(await testDb.notificationQueue.count()).toBe(4);
  });
});

describe("lead time setting before work end", () => {
  it("triggers before shift end with default 60 minute lead time", async () => {
    await setupTeam();

    const tooEarly = new Date("2026-08-17T13:25:00.000Z");
    expect((await sendMissingActivityReminders(testDb, tooEarly)).skippedNotDue).toBe(true);

    const onTime = new Date("2026-08-17T13:35:00.000Z");
    const result = await sendMissingActivityReminders(testDb, onTime);
    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBe(2);
  });

  it("triggers only after shift end when lead time is set to 0", async () => {
    await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "0",
    });

    const duringWork = new Date("2026-08-17T14:00:00.000Z");
    expect((await sendMissingActivityReminders(testDb, duringWork)).skippedNotDue).toBe(true);

    const afterWork = new Date("2026-08-17T14:35:00.000Z");
    const result = await sendMissingActivityReminders(testDb, afterWork);
    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBe(2);
  });

  it("triggers 1.5 hours before work end when lead time is 90 minutes", async () => {
    await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "90",
    });

    const tooEarly = new Date("2026-08-17T12:55:00.000Z");
    expect((await sendMissingActivityReminders(testDb, tooEarly)).skippedNotDue).toBe(true);

    const onTime = new Date("2026-08-17T13:05:00.000Z");
    const result = await sendMissingActivityReminders(testDb, onTime);
    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBe(2);
  });

  it("clamps lead time so it cannot trigger before shift start", async () => {
    await setupTeam();
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workStartMinute: 16 * 60,
      workEndMinute: 17 * 60,
    });
    await saveSettings(testDb, {
      [SETTING_KEYS.noActivityReminderLeadMinutes]: "120",
    });

    const beforeShift = new Date("2026-08-17T12:30:00.000Z");
    expect((await sendMissingActivityReminders(testDb, beforeShift)).skippedNotDue).toBe(
      true,
    );

    const afterShiftStart = new Date("2026-08-17T13:05:00.000Z");
    const result = await sendMissingActivityReminders(testDb, afterShiftStart);
    expect(result.skippedNotDue).toBe(false);
    expect(result.queued).toBe(2);
  });
});
