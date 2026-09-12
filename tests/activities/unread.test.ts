import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countUnreadInScope } from "@/server/activities/unread";
import { subordinateUserIds } from "@/server/authz/visibility";
import { markActivityAsRead } from "@/server/reads/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Unread activity counter.
// Crucial guarantee: counts strictly pass through the visibility authorization layer.
// Invisible records never leak into unread count totals.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({ name: "Tooling Department", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: root.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Tooling Specialist" });
  const peerManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  return { generalManager, manager, employee, peerManager };
}

async function createActivityRecord(
  user: { id: string; orgUnitId: string },
  title: string,
  status: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: user.id,
      authorOrgUnitId: user.orgUnitId,
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      title,
      description: "Content",
      approvalStatus: status,
    },
  });
}

async function countUnread(user: { id: string }) {
  const subordinates = await subordinateUserIds(testDb, user.id);
  return countUnreadInScope(
    testDb,
    { id: user.id, isSystemAdmin: false },
    subordinates,
  );
}

describe("unread activities counter", () => {
  it("counts unread activities within user scope", async () => {
    const { manager, employee } = await setupCompany();
    await createActivityRecord(employee, "One");
    await createActivityRecord(employee, "Two");

    expect(await countUnread(manager)).toBe(2);
  });

  it("decrements count when activities are marked as read", async () => {
    const { manager, employee } = await setupCompany();
    const record = await createActivityRecord(employee, "One");
    await createActivityRecord(employee, "Two");

    await markActivityAsRead(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      record.id,
      3_000,
      NOW,
    );

    expect(await countUnread(manager)).toBe(1);
  });

  it("excludes activities authored by the viewer", async () => {
    const { manager } = await setupCompany();
    await createActivityRecord(manager, "Own record");

    expect(await countUnread(manager)).toBe(0);
  });

  it("excludes cancelled activities from unread count", async () => {
    const { manager, employee } = await setupCompany();
    await createActivityRecord(employee, "Cancelled", "CANCELLED");

    expect(await countUnread(manager)).toBe(0);
  });

  it("excludes activities outside viewer scope from count", async () => {
    const { manager, peerManager } = await setupCompany();
    await createActivityRecord(peerManager, "Peer record");

    expect(await countUnread(manager)).toBe(0);
  });

  it("returns zero for users without subordinates", async () => {
    const { employee, peerManager } = await setupCompany();
    await createActivityRecord(peerManager, "Another record");

    expect(await countUnread(employee)).toBe(0);
  });

  it("counts activities across all subordinate hierarchy levels for higher management", async () => {
    const { generalManager, employee, manager } = await setupCompany();
    await createActivityRecord(employee, "Employee record");
    await createActivityRecord(manager, "Manager record");

    expect(await countUnread(generalManager)).toBe(2);
  });
});
