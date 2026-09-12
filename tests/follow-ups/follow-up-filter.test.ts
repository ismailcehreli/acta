import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listFollowUps } from "@/server/follow-ups/read";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Follow-up list filtering and pagination tests.
// Single list structure with badges for priority and ownership.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Tooling Worker" });
  const outsider = await createUser(planning.id, { fullName: "Planner" });

  return { tooling, manager, employee, outsider };
}

async function createFollowUp(
  author: { id: string; orgUnitId: string },
  owner: { id: string },
  title: string,
  movedAt: Date,
  status: "OPEN" | "CLOSED" = "OPEN",
) {
  const activity = await createActivity(author, { title });
  return testDb.followUpItem.create({
    data: {
      activityId: activity.id,
      openedById: author.id,
      ownerId: owner.id,
      status,
      openedAt: movedAt,
      lastMovedAt: movedAt,
      ...(status === "CLOSED"
        ? { closedById: owner.id, closedAt: NOW, closingNote: "Resolved" }
        : {}),
    },
  });
}

/** 12 business days ago: exceeds default idle threshold (5). */
const OLD_DATE = new Date("2026-08-03T09:00:00.000Z");
const NEW_DATE = new Date("2026-08-18T09:00:00.000Z");

describe("status filter", () => {
  it("returns only open items by default", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, employee, "Open item", NEW_DATE);
    await createFollowUp(employee, employee, "Closed item", NEW_DATE, "CLOSED");

    const result = await listFollowUps(testDb, { id: manager.id, isSystemAdmin: false }, NOW, {});

    expect(result.items.map((m) => m.activityTitle)).toEqual(["Open item"]);
  });

  it("returns only closed items when status is CLOSED", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, employee, "Open item", NEW_DATE);
    await createFollowUp(employee, employee, "Closed item", NEW_DATE, "CLOSED");

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      { status: "CLOSED" },
    );

    expect(result.items.map((m) => m.activityTitle)).toEqual(["Closed item"]);
  });
});

describe("owner filter", () => {
  it("returns only items owned by the specified user", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, employee, "Assigned to worker", NEW_DATE);
    await createFollowUp(employee, manager, "Assigned to manager", NEW_DATE);

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      { ownerId: employee.id },
    );

    expect(result.items.map((m) => m.activityTitle)).toEqual(["Assigned to worker"]);
  });
});

describe("idle filter", () => {
  it("returns only items that exceed idle threshold", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, employee, "Stale item", OLD_DATE);
    await createFollowUp(employee, employee, "Fresh item", NEW_DATE);

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      { staleOnly: true },
    );

    expect(result.items.map((m) => m.activityTitle)).toEqual(["Stale item"]);
  });
});

describe("sorting carries priority", () => {
  it("sorts longest idle item first", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, employee, "Fresh item", NEW_DATE);
    await createFollowUp(employee, employee, "Stale item", OLD_DATE);

    const result = await listFollowUps(testDb, { id: manager.id, isSystemAdmin: false }, NOW, {});

    expect(result.items[0]?.activityTitle).toBe("Stale item");
  });
});

describe("pagination", () => {
  it("returns requested count and reports total", async () => {
    const { manager, employee } = await setupCompany();
    for (const name of ["One", "Two", "Three"]) await createFollowUp(employee, employee, name, NEW_DATE);

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      {},
      { limit: 2 },
    );

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
  });
});

describe("filter never broadens scope", () => {
  it("never returns items outside viewer's scope under any filter", async () => {
    const { manager, employee, outsider } = await setupCompany();
    await createFollowUp(outsider, outsider, "Other department item", OLD_DATE);
    await createFollowUp(employee, employee, "Own team item", NEW_DATE);

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      { staleOnly: true },
    );

    expect(result.items).toHaveLength(0);
  });
});

describe("ownership indicator on row", () => {
  it("marks whether the viewing user is the owner", async () => {
    const { manager, employee } = await setupCompany();
    await createFollowUp(employee, manager, "Manager's item", NEW_DATE);
    await createFollowUp(employee, employee, "Worker's item", NEW_DATE);

    const result = await listFollowUps(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      NOW,
      {},
    );

    const mine = result.items.find((m) => m.activityTitle === "Manager's item");
    const others = result.items.find((m) => m.activityTitle === "Worker's item");

    expect(mine?.mine).toBe(true);
    expect(others?.mine).toBe(false);
  });
});
