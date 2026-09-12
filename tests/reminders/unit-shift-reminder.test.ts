import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveUnitWorkCalendar } from "@/server/calendar/unit-calendar";
import { saveWorkCalendar } from "@/server/calendar/settings";
import { sendMissingActivityReminders } from "@/worker/reminders/no-activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Shift-end reminder checks unit-specific work window (Task 11.9).
//
// Specific operational need: one warehouse operates 07:00–17:00, another 08:00–18:00.
// A company-wide single window sent reminders an hour late to the early shift.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const FRIDAY = "2026-08-21";

/** An instant at given company time (UTC = Istanbul - 3 hours). */
function companyTime(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 21, (h as number) - 3, m as number));
}

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const warehouseA = await createOrgUnit({ name: "Warehouse A", parentId: root.id });
  const warehouseB = await createOrgUnit({ name: "Warehouse B", parentId: root.id });

  const userA = await createUser(warehouseA.id, { fullName: "User A" });
  const userB = await createUser(warehouseB.id, { fullName: "User B" });

  await saveWorkCalendar(testDb, {
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 8 * 60,
    workEndMinute: 18 * 60,
  });

  return { warehouseA, warehouseB, userA, userB };
}

describe("unit-based work shift window", () => {
  it("reminds early closing warehouse 1 hour before shift end (16:00)", async () => {
    const { warehouseA, userA, userB } = await setupCompany();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const result = await sendMissingActivityReminders(testDb, companyTime("16:05"));

    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).toEqual([userA.id]);
    // Later closing warehouse reminder time (17:00) has not arrived yet
    expect(queue.map((k) => k.userId)).not.toContain(userB.id);
  });

  it("reminds later closing warehouse 1 hour before its shift end (17:00)", async () => {
    const { warehouseA, userB } = await setupCompany();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const result = await sendMissingActivityReminders(testDb, companyTime("17:05"));

    // Both shift reminder times have arrived; both receive reminders
    expect(result.queued).toBe(2);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).toContain(userB.id);
  });
});

describe("official holiday flag", () => {
  it("does not send reminders to units not working on holidays", async () => {
    const { userA } = await setupCompany();
    await testDb.holiday.create({
      data: { date: new Date(`${FRIDAY}T00:00:00.000Z`), description: "Test holiday" },
    });

    const result = await sendMissingActivityReminders(testDb, companyTime("18:05"));

    expect(result.queued).toBe(0);
    expect(
      await testDb.notificationQueue.count({ where: { userId: userA.id } }),
    ).toBe(0);
  });

  it("sends reminders to units working on holidays", async () => {
    const { warehouseA, userA, userB } = await setupCompany();
    await testDb.holiday.create({
      data: { date: new Date(`${FRIDAY}T00:00:00.000Z`), description: "Test holiday" },
    });
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const result = await sendMissingActivityReminders(testDb, companyTime("18:05"));

    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).toEqual([userA.id]);
    expect(queue.map((k) => k.userId)).not.toContain(userB.id);
  });
});

describe("unit-based working days", () => {
  it("sends reminder on Saturday to units that work on Saturday", async () => {
    const { warehouseA, userA } = await setupCompany();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: false,
    });

    // Saturday, 22 Aug 2026, 18:05 company time
    const saturday = new Date(Date.UTC(2026, 7, 22, 15, 5));
    const result = await sendMissingActivityReminders(testDb, saturday);

    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany();
    expect(queue.map((k) => k.userId)).toEqual([userA.id]);
  });
});
