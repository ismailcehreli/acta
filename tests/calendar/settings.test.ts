import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addHoliday,
  DEFAULT_WORK_CALENDAR,
  listHolidays,
  readWorkCalendar,
  removeHoliday,
  saveWorkCalendar,
} from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { minuteToTime, timeToMinute } from "@/shared/schemas/calendar";

import { resetDatabase, testDb } from "../helpers/test-db";

// Work calendar §12.1: single definition across company.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("work calendar", () => {
  it("returns weekday default when no record exists", async () => {
    expect(await readWorkCalendar(testDb)).toEqual(DEFAULT_WORK_CALENDAR);
  });

  it("saves and reads back", async () => {
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    expect(await readWorkCalendar(testDb)).toEqual({
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 540,
      workEndMinute: 1080,
    });
  });

  it("second save updates existing record rather than adding new", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [1, 2, 3],
    });

    expect(await testDb.workCalendar.count()).toBe(1);
    expect((await readWorkCalendar(testDb)).workingDays).toEqual([1, 2, 3]);
  });

  it("days are stored sorted and unique", async () => {
    await saveWorkCalendar(testDb, {
      ...DEFAULT_WORK_CALENDAR,
      workingDays: [5, 1, 3, 1],
    });

    expect((await readWorkCalendar(testDb)).workingDays).toEqual([1, 3, 5]);
  });

  it("rejects a second calendar record at database level", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);

    await expect(
      testDb.workCalendar.create({
        data: { id: 2, workingDays: [1], workStartMinute: 0, workEndMinute: 60 },
      }),
    ).rejects.toThrow(/WorkCalendar_singleton/);
  });
});

describe("holiday list", () => {
  it("adds and returns sorted by date", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Republic Day" });
    await addHoliday(testDb, { date: "2026-08-30", description: "Victory Day" });

    expect(await listHolidays(testDb)).toEqual([
      { date: "2026-08-30", description: "Victory Day" },
      { date: "2026-10-29", description: "Republic Day" },
    ]);
  });

  it("cannot add the same date twice", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Republic Day" });

    const result = await addHoliday(testDb, {
      date: "2026-10-29",
      description: "Repeat",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_exists");
    expect(await testDb.holiday.count()).toBe(1);
  });

  it("can remove incorrectly entered holiday", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "Incorrect" });

    expect(await removeHoliday(testDb, "2026-10-29")).toBe(true);
    expect(await listHolidays(testDb)).toEqual([]);
    // Removing non-existent date is not considered successful.
    expect(await removeHoliday(testDb, "2026-10-29")).toBe(false);
  });

  it("filters by year", async () => {
    await addHoliday(testDb, { date: "2026-10-29", description: "2026" });
    await addHoliday(testDb, { date: "2027-01-01", description: "2027" });

    expect(await listHolidays(testDb, 2026)).toHaveLength(1);
  });

  it("business day calculation uses these holidays", async () => {
    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
    await addHoliday(testDb, { date: "2026-08-19", description: "Test" });

    const calendar = await loadWorkCalendar(
      testDb,
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    );

    expect(calendar.holidays).toContain("2026-08-19");
    expect(calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("time display", () => {
  it("converts back and forth between minutes and string", () => {
    expect(minuteToTime(510)).toBe("08:30");
    expect(minuteToTime(0)).toBe("00:00");
    expect(timeToMinute("08:30")).toBe(510);
    expect(timeToMinute("17:30")).toBe(1050);
  });

  it("invalid text is not converted to number", () => {
    for (const invalid of ["", "8", "08:60", "25:00", "abc"]) {
      expect(timeToMinute(invalid)).toBeNull();
    }
  });
});
