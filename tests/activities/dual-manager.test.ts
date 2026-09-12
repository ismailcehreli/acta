import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, rejectActivity } from "@/server/activities/approval";
import { listApprovalGroups } from "@/server/activities/approval-groups";
import { listPendingApprovals } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";
import { visibleActivityWhere } from "@/server/authz/visibility";
import { resolveManagers } from "@/server/org/resolve-manager";
import { listScopeActivities } from "@/server/activities/scope-feed";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Multiple managers in the same org unit.
// Rule: activity appears in both managers' approval queues; the first manager to decide
// closes the round and clears the item from the other manager's queue.

const NOW = new Date("2026-08-20T09:00:00.000Z");

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company" });
  const tooling = await createOrgUnit({
    name: "Tooling",
    parentId: root.id,
    requiresApproval: true,
  });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const ceo = await createUser(root.id, {
    fullName: "Chief Executive",
    email: "ceo@example.test",
    isUnitManager: true,
  });
  // Two managers in the same unit
  const managerA = await createUser(tooling.id, {
    fullName: "Manager A",
    email: "manager-a@example.test",
    isUnitManager: true,
  });
  const managerB = await createUser(tooling.id, {
    fullName: "Manager B",
    email: "manager-b@example.test",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, {
    fullName: "Worker",
    email: "worker@example.test",
  });
  const outsider = await createUser(planning.id, {
    fullName: "Planner",
    email: "planner@example.test",
  });

  return { root, tooling, ceo, managerA, managerB, employee, outsider };
}

async function writeActivity(employee: { id: string; orgUnitId: string }) {
  const result = await createActivity(
    testDb,
    { id: employee.id, orgUnitId: employee.orgUnitId, requiresApproval: true },
    {
      activityDate: "2026-08-20",
      title: "Tooling maintenance",
      description: "Serviced three press lines.",
      targetDepartmentIds: [],
    },
    NOW,
  );

  if (!result.ok) throw new Error(`Activity write failed: ${result.error}`);
  return result.activity;
}

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("dual managers in single org unit", () => {
  it("resolves both managers for subordinate employee", async () => {
    const { managerA, managerB, employee } = await setupCompany();

    const result = await resolveManagers(testDb, employee.id);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect([...result.managerIds].sort()).toEqual([managerA.id, managerB.id].sort());
  });

  it("managers are not managers of each other; their superior is CEO", async () => {
    const { ceo, managerA, managerB } = await setupCompany();

    for (const manager of [managerA, managerB]) {
      const result = await resolveManagers(testDb, manager.id);
      expect(result.found).toBe(true);
      if (!result.found) continue;
      expect(result.managerIds).toEqual([ceo.id]);
    }
  });

  it("both managers recorded as eligible approvers when activity is created", async () => {
    const { managerA, managerB, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    expect(activity.approvalStatus).toBe("PENDING_APPROVAL");

    const approvers = await testDb.activityApprover.findMany({
      where: { activityId: activity.id },
      select: { userId: true },
    });
    expect(approvers.map((u) => u.userId).sort()).toEqual(
      [managerA.id, managerB.id].sort(),
    );
  });

  it("activity appears in approval queue of both managers", async () => {
    const { managerA, managerB, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    for (const manager of [managerA, managerB]) {
      const queue = await listPendingApprovals(testDb, manager.id);
      expect(queue.map((k) => k.id)).toContain(activity.id);

      const groups = await listApprovalGroups(testDb, manager.id, NOW);
      expect(groups.flatMap((g) => g.items.map((i) => i.id))).toContain(activity.id);
    }
  });

  it("both managers can view activity; outsider cannot", async () => {
    const { managerA, managerB, employee, outsider } = await setupCompany();
    const activity = await writeActivity(employee);

    for (const manager of [managerA, managerB]) {
      const where = await visibleActivityWhere(testDb, viewer(manager));
      const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);
      expect(ids).toContain(activity.id);
    }

    const outsiderWhere = await visibleActivityWhere(testDb, viewer(outsider));
    const outsiderIds = (await testDb.activity.findMany({ where: outsiderWhere })).map(
      (a) => a.id,
    );
    expect(outsiderIds).not.toContain(activity.id);

    const { items } = await listScopeActivities(testDb, viewer(outsider), {}, NOW);
    expect(items.map((i) => i.id)).not.toContain(activity.id);
  });

  it("pending activity does not flow up to higher management", async () => {
    const { ceo, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    const where = await visibleActivityWhere(testDb, viewer(ceo));
    const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);

    expect(ids).not.toContain(activity.id);
  });

  it("when one manager approves, activity clears from the other's queue", async () => {
    const { managerA, managerB, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    const result = await approveActivity(testDb, managerA.id, activity.id, NOW);
    expect(result.ok).toBe(true);

    expect(await listPendingApprovals(testDb, managerA.id)).toHaveLength(0);
    expect(await listPendingApprovals(testDb, managerB.id)).toHaveLength(0);

    const updated = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(updated.approvalStatus).toBe("APPROVED");
    expect(updated.approverId).toBe(managerA.id);
  });

  it("late decision by second manager is rejected", async () => {
    const { managerA, managerB, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    const first = await approveActivity(testDb, managerA.id, activity.id, NOW);
    expect(first.ok).toBe(true);

    const reason = await testDb.approvalReason.create({
      data: { kind: "REJECTED", label: "Duplicate activity" },
    });

    const lateDecision = await rejectActivity(
      testDb,
      managerB.id,
      activity.id,
      { reasonId: reason.id, note: "Late rejection attempt" },
      NOW,
    );

    expect(lateDecision.ok).toBe(false);

    const updated = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(updated.approvalStatus).toBe("APPROVED");
    expect(updated.approverId).toBe(managerA.id);
  });

  it("non-approver cannot make approval decision", async () => {
    const { ceo, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    const result = await approveActivity(testDb, ceo.id, activity.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");

    const updated = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(updated.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("both managers receive notification", async () => {
    const { managerA, managerB, employee } = await setupCompany();
    const activity = await writeActivity(employee);

    for (const manager of [managerA, managerB]) {
      const rows = await testDb.notificationQueue.findMany({
        where: { userId: manager.id, eventType: "approval_pending" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ activityId: activity.id });
    }
  });
});
