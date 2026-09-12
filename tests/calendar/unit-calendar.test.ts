import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  resolveUnitWorkWindow,
  saveUnitWorkCalendar,
} from "@/server/calendar/unit-calendar";
import { saveWorkCalendar } from "@/server/calendar/settings";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Unit-specific work window (Task 11.9, design Package H).
//
// Work window specifies which days are worked, when shift ends, and whether public holidays are worked.
// If a unit has no row, it checks parent unit, falling back to company default at root.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupOrgTree() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const factory = await createOrgUnit({ name: "Factory", parentId: root.id });
  const warehouseA = await createOrgUnit({ name: "Warehouse A", parentId: factory.id });
  const warehouseB = await createOrgUnit({ name: "Warehouse B", parentId: factory.id });
  const sales = await createOrgUnit({ name: "Sales", parentId: root.id });

  return { root, factory, warehouseA, warehouseB, sales };
}

describe("inheritance", () => {
  it("uses unit's own row if present", async () => {
    const { warehouseA } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const window = await resolveUnitWorkWindow(testDb, warehouseA.id);

    expect(window.workEndMinute).toBe(17 * 60);
    expect(window.source).toBe("unit");
  });

  it("inherits from parent unit if no row exists", async () => {
    const { factory, warehouseB } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, factory.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const window = await resolveUnitWorkWindow(testDb, warehouseB.id);

    expect(window.workEndMinute).toBe(18 * 60);
    expect(window.worksOnHolidays).toBe(true);
    expect(window.source).toBe("inherited");
    expect(window.sourceUnitName).toBe("Factory");
  });

  it("falls back to company default if no parent has calendar", async () => {
    const { warehouseA } = await setupOrgTree();
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    const window = await resolveUnitWorkWindow(testDb, warehouseA.id);

    expect(window.workEndMinute).toBe(18 * 60);
    expect(window.source).toBe("company");
  });

  it("nearest parent wins", async () => {
    const { root, factory, warehouseA } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, root.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: false,
    });
    await saveUnitWorkCalendar(testDb, factory.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const window = await resolveUnitWorkWindow(testDb, warehouseA.id);

    expect(window.workEndMinute).toBe(17 * 60);
    expect(window.sourceUnitName).toBe("Factory");
  });

  it("sibling unit is unaffected", async () => {
    const { warehouseA, sales } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    const window = await resolveUnitWorkWindow(testDb, sales.id);

    expect(window.workEndMinute).toBe(18 * 60);
    expect(window.source).toBe("company");
  });
});

describe("public holiday flag", () => {
  it("holiday is a working day when flag is enabled", async () => {
    const { warehouseA } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, warehouseA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const window = await resolveUnitWorkWindow(testDb, warehouseA.id);

    expect(window.worksOnHolidays).toBe(true);
  });

  it("defaults to not working on holidays", async () => {
    const { sales } = await setupOrgTree();

    const window = await resolveUnitWorkWindow(testDb, sales.id);

    expect(window.worksOnHolidays).toBe(false);
  });
});

describe("database constraints", () => {
  it("end minute cannot be less than start minute", async () => {
    const { warehouseA } = await setupOrgTree();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: warehouseA.id,
          workingDays: [1, 2, 3],
          workStartMinute: 18 * 60,
          workEndMinute: 8 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_window/);
  });

  it("working days cannot be empty", async () => {
    const { warehouseA } = await setupOrgTree();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: warehouseA.id,
          workingDays: [],
          workStartMinute: 8 * 60,
          workEndMinute: 18 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_days/);
  });

  it("invalid day number rejected", async () => {
    const { warehouseA } = await setupOrgTree();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: warehouseA.id,
          workingDays: [1, 9],
          workStartMinute: 8 * 60,
          workEndMinute: 18 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_days/);
  });
});
