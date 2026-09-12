import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requestChanges } from "@/server/activities/approval";
import { listWorkQueue } from "@/server/dashboard/work-queue";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Unified work queue tests.
// Verifies that items reach the correct recipient, are sorted by waiting time,
// and do not leak across users.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const executive = await createOrgUnit({ name: "Executive Management", parentId: root.id });
  const tooling = await createOrgUnit({
    name: "Tooling",
    parentId: executive.id,
    requiresApproval: true,
  });
  const planning = await createOrgUnit({ name: "Planning", parentId: executive.id });

  const ceo = await createUser(executive.id, {
    fullName: "Chief Executive",
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

  return { ceo, manager, employee, peerManager };
}

const viewer = (id: string) => ({ id, isSystemAdmin: false });

describe("items routed to work queue", () => {
  it("pending activity appears in approver's queue", async () => {
    const { manager, employee } = await setupCompany();
    await createActivity(employee, {
      title: "Pending approval task",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const queue = await listWorkQueue(testDb, viewer(manager.id), NOW);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.kind).toBe("approve");
    expect(queue.items[0]?.fromName).toBe("Tooling Specialist");
  });

  it("changes requested activity appears in author's queue", async () => {
    const { manager, employee } = await setupCompany();
    const activity = await createActivity(employee, {
      title: "Task requiring revision",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const authorQueue = await listWorkQueue(testDb, viewer(employee.id), NOW);

    expect(authorQueue.items.map((item) => item.kind)).toEqual(["revise"]);
    expect(authorQueue.items[0]?.fromName).toBe("Tooling Manager");
  });

  it("changes requested activity disappears from manager's queue", async () => {
    const { manager, employee } = await setupCompany();
    const activity = await createActivity(employee, {
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const managerQueue = await listWorkQueue(testDb, viewer(manager.id), NOW);

    expect(managerQueue.items).toHaveLength(0);
  });

  it("another user's pending approvals do not leak into other queues", async () => {
    const { manager, employee, ceo, peerManager } = await setupCompany();
    await createActivity(employee, {
      title: "Pending manager approval",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    for (const other of [ceo, peerManager, employee]) {
      const queue = await listWorkQueue(testDb, viewer(other.id), NOW);
      expect(queue.items.filter((item) => item.kind === "approve")).toHaveLength(0);
    }
  });

  it("approved activity does not remain in work queue", async () => {
    const { manager, employee } = await setupCompany();
    await createActivity(employee, {
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });

    expect((await listWorkQueue(testDb, viewer(manager.id), NOW)).items).toHaveLength(0);
  });

  it("rejected activity does not remain in any work queue", async () => {
    const { manager, employee } = await setupCompany();
    const reason = await createApprovalReason("REJECTED");
    await createActivity(employee, {
      approvalStatus: "REJECTED",
      approverId: manager.id,
      approvalReasonId: reason.id,
      approvalReasonKind: "REJECTED",
    });

    expect((await listWorkQueue(testDb, viewer(manager.id), NOW)).items).toHaveLength(0);
    expect((await listWorkQueue(testDb, viewer(employee.id), NOW)).items).toHaveLength(0);
  });
});

describe("sorting and waiting time", () => {
  it("sorts oldest waiting item first", async () => {
    const { manager, employee } = await setupCompany();
    await createActivity(employee, {
      title: "New task",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });
    await createActivity(employee, {
      title: "Old task",
      activityDate: new Date("2026-08-13T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const queue = await listWorkQueue(testDb, viewer(manager.id), NOW);

    expect(queue.items.map((item) => item.activityTitle)).toEqual([
      "Old task",
      "New task",
    ]);
  });

  it("counts waiting time in business days, skipping weekends", async () => {
    const { manager, employee } = await setupCompany();
    // Friday August 14 to Wednesday August 19: 5 calendar days, 3 business days
    await createActivity(employee, {
      activityDate: new Date("2026-08-14T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const queue = await listWorkQueue(testDb, viewer(manager.id), NOW);

    expect(queue.items[0]?.waitingBusinessDays).toBe(3);
  });

  it("task submitted today has zero waiting business days", async () => {
    const { manager, employee } = await setupCompany();
    await createActivity(employee, {
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    expect(
      (await listWorkQueue(testDb, viewer(manager.id), NOW)).items[0]
        ?.waitingBusinessDays,
    ).toBe(0);
  });
});

describe("empty queue", () => {
  it("queue is empty when user has no pending action items", async () => {
    const { peerManager } = await setupCompany();

    const queue = await listWorkQueue(testDb, viewer(peerManager.id), NOW);

    expect(queue.items).toHaveLength(0);
    expect(queue.watched).toHaveLength(0);
  });
});
