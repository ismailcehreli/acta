import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { departmentSummary } from "@/server/dashboard/department-summary";
import { subordinateUserIds } from "@/server/authz/visibility";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Department-level summary.
//
// Critical invariant regarding data leak: the summary must not count a record
// that the feed cannot see. Count is also information (§18.4).

const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const directorate = await createOrgUnit({ name: "Directorate", parentId: root.id });
  const moldShop = await createOrgUnit({ name: "Mold Shop", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: directorate.id });
  // A branch outside the director scope: must not enter count.
  const accounting = await createOrgUnit({ name: "Accounting", parentId: root.id });

  const director = await createUser(directorate.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const moldWorker = await createUser(moldShop.id, { fullName: "Mold Worker" });
  const planner = await createUser(planning.id, { fullName: "Planner" });
  const accountant = await createUser(accounting.id, { fullName: "Accountant" });

  return {
    director,
    moldWorker,
    planner,
    accountant,
    moldShop,
    planning,
    accounting,
  };
}

async function createActivityRecord(
  user: { id: string; orgUnitId: string },
  date: string,
  status: "APPROVED" | "CANCELLED" | "PENDING_APPROVAL" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: user.id,
      authorOrgUnitId: user.orgUnitId,
      activityDate: new Date(`${date}T00:00:00.000Z`),
      title: `Record ${date}`,
      description: "content",
      approvalStatus: status,
      approverId:
        status === "PENDING_APPROVAL" ? await resolveApproverId(user.id) : null,
    },
  });
}

/**
 * A record in approval status requires an approver (constraint
 * `Activity_approver_required_in_approval`). The manager resolved by §4.4
 * is used so that the test fixture matches production rules.
 */
async function resolveApproverId(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const result = await resolveManager(testDb, userId);
  return result.found ? result.managerId : null;
}

async function getSummary(
  viewerId: string,
  period: "today" | "week" | "all" = "week",
  includeRoot = false,
) {
  const subordinates = await subordinateUserIds(testDb, viewerId);
  return departmentSummary(
    testDb,
    { id: viewerId, isSystemAdmin: false },
    subordinates,
    period,
    NOW,
    { includeRoot },
  );
}

describe("department summary", () => {
  it("returns a row for each subordinate department", async () => {
    const { director, moldWorker, planner } = await setupCompany();
    await createActivityRecord(moldWorker, "2026-08-18");
    await createActivityRecord(moldWorker, "2026-08-17");
    await createActivityRecord(planner, "2026-08-18");

    const rows = await getSummary(director.id);

    expect(rows.map((s) => s.name)).toEqual(["Mold Shop", "Planning"]);
    expect(rows[0]).toMatchObject({ people: 1, activityCount: 2 });
    expect(rows[1]).toMatchObject({ people: 1, activityCount: 1 });
  });

  it("manager record in the same unit is excluded from managed count", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Operasyon", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Operations Manager",
      isUnitManager: true,
    });
    const worker = await createUser(unit.id, { fullName: "Operations Employee" });

    await createActivityRecord(manager, "2026-08-18");
    await createActivityRecord(worker, "2026-08-18");

    const rows = await getSummary(manager.id, "week", true);
    const operation = rows.find((row) => row.name === "Operasyon");

    expect(operation).toMatchObject({
      people: 1,
      activityCount: 1,
      directPeople: 1,
      directActivityCount: 1,
    });
  });

  it("out-of-scope department does not appear at all", async () => {
    const { director, accountant } = await setupCompany();
    await createActivityRecord(accountant, "2026-08-18");

    const rows = await getSummary(director.id);

    // Accounting is not under director: neither row nor count should appear.
    expect(rows.map((s) => s.name)).not.toContain("Accounting");
    expect(rows.reduce((t, s) => t + s.activityCount, 0)).toBe(0);
  });

  it("records invisible to the manager are not counted", async () => {
    const { director, moldWorker, moldShop } = await setupCompany();
    // Mold Shop gets its own manager: pending approval record goes to them,
    // not to director. Director must not see it (§8.2) and it must not be counted.
    await createUser(moldShop.id, {
      fullName: "Mold Shop Manager",
      isUnitManager: true,
    });
    await createActivityRecord(moldWorker, "2026-08-18", "PENDING_APPROVAL");
    await createActivityRecord(moldWorker, "2026-08-18");

    const rows = await getSummary(director.id);

    // Two records exist but director cannot see one; count must be 1. Count is
    // also information - it must not disclose existence of invisible record (§18.4).
    expect(rows.find((s) => s.name === "Mold Shop")?.activityCount).toBe(1);
  });

  it("cancelled record is not counted", async () => {
    const { director, moldWorker } = await setupCompany();
    await createActivityRecord(moldWorker, "2026-08-18", "CANCELLED");

    const rows = await getSummary(director.id);

    expect(rows.find((s) => s.name === "Mold Shop")?.activityCount).toBe(0);
  });

  it("period filter narrows the count", async () => {
    const { director, moldWorker } = await setupCompany();
    await createActivityRecord(moldWorker, "2026-08-18");
    await createActivityRecord(moldWorker, "2026-08-11");

    const thisWeek = await getSummary(director.id, "week");
    const all = await getSummary(director.id, "all");

    expect(thisWeek.find((s) => s.name === "Mold Shop")?.activityCount).toBe(1);
    expect(all.find((s) => s.name === "Mold Shop")?.activityCount).toBe(2);
  });

  it("summary is empty for user with no subordinates", async () => {
    const { moldWorker } = await setupCompany();

    expect(await getSummary(moldWorker.id)).toEqual([]);
  });

  it("top manager sees subordinate branches in a hierarchical rollup", async () => {
    const { director, moldWorker, planner, accountant } = await setupCompany();
    const root = await testDb.orgUnit.findFirstOrThrow({
      where: { parentId: null },
    });
    const board = await createUser(root.id, {
      fullName: "Executive Board",
      isUnitManager: true,
    });

    await createActivityRecord(moldWorker, "2026-08-18");
    await createActivityRecord(planner, "2026-08-18");
    await createActivityRecord(accountant, "2026-08-18");

    const rows = await getSummary(board.id, "week", true);

    expect(rows.map((s) => s.name)).toEqual([
      "Company",
      "Accounting",
      "Directorate",
      "Mold Shop",
      "Planning",
    ]);
    expect(rows.find((row) => row.name === "Company")).toMatchObject({
      people: 4,
      activityCount: 3,
      isRollup: true,
      depth: 0,
    });
    expect(rows.find((row) => row.name === "Directorate")).toMatchObject({
      people: 3,
      activityCount: 2,
      isRollup: true,
      depth: 1,
    });
    expect(rows.find((row) => row.name === "Mold Shop")).toMatchObject({
      people: 1,
      directPeople: 1,
      activityCount: 1,
      directActivityCount: 1,
      depth: 2,
    });
    expect(rows.find((row) => row.name === "Accounting")).toMatchObject({
      people: 1,
      activityCount: 1,
      depth: 1,
    });
    expect(director.isUnitManager).toBe(true);
  });
});

describe("participation column (§12.1)", () => {
  it("not calculated when setting is disabled", async () => {
    const { director, moldWorker } = await setupCompany();
    await createActivityRecord(moldWorker, "2026-08-18");

    const rows = await getSummary(director.id);

    expect(rows.every((s) => s.participation === null)).toBe(true);
  });

  it("counts users who wrote today when setting is enabled", async () => {
    const { director, moldWorker } = await setupCompany();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await createActivityRecord(moldWorker, "2026-08-18");

    const rows = await getSummary(director.id);

    expect(rows.find((s) => s.name === "Mold Shop")?.participation).toEqual({
      wrote: 1,
      expected: 1,
    });
    expect(rows.find((s) => s.name === "Planning")?.participation).toEqual({
      wrote: 0,
      expected: 1,
    });
  });

  it("user not expected to write activities is excluded from denominator", async () => {
    const { director, moldWorker } = await setupCompany();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.update({
      where: { id: moldWorker.id },
      data: { writesActivities: false },
    });

    const rows = await getSummary(director.id);

    // Headcount remains (neutral info), but because expectation is 0,
    // participation column is not rendered.
    const moldShop = rows.find((s) => s.name === "Mold Shop");
    expect(moldShop?.people).toBe(1);
    expect(moldShop?.participation).toBeNull();
  });
});
