import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveMany,
  listApprovalGroups,
} from "@/server/activities/approval-groups";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Batch approval grouped by user and date.
// Key principles:
//   1. Batch approval does not grant unauthorized access.
//   2. Content not displayed is never approved.

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

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const peerManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const worker1 = await createUser(tooling.id, { fullName: "Worker One" });
  const worker2 = await createUser(tooling.id, { fullName: "Worker Two" });

  return { manager, peerManager, worker1, worker2 };
}

function pendingActivityInput(day: string, title: string, approverId: string) {
  return {
    title,
    activityDate: new Date(`${day}T00:00:00.000Z`),
    approvalStatus: "PENDING_APPROVAL" as const,
    approverId,
    approvalSubmittedAt: NOW,
  };
}

describe("grouping pending approvals", () => {
  it("groups activities by the same author on the same day", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Morning task", manager.id));
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Afternoon task", manager.id));

    const groups = await listApprovalGroups(testDb, manager.id, NOW);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[0]?.authorName).toBe("Worker One");
  });

  it("splits activities on different dates into separate groups", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Yesterday", manager.id));
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Today", manager.id));

    const groups = await listApprovalGroups(testDb, manager.id, NOW);

    expect(groups).toHaveLength(2);
    // Oldest date first: longest waiting task comes first.
    expect(groups[0]?.day).toBe("2026-08-18");
  });

  it("splits activities by different authors into separate groups", async () => {
    const { manager, worker1, worker2 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Worker 1 task", manager.id));
    await createActivity(worker2, pendingActivityInput("2026-08-19", "Worker 2 task", manager.id));

    const groups = await listApprovalGroups(testDb, manager.id, NOW);

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.authorName))).toEqual(
      new Set(["Worker One", "Worker Two"]),
    );
  });

  it("excludes activities assigned to another approver", async () => {
    const { manager, peerManager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Manager task", manager.id));

    expect(await listApprovalGroups(testDb, peerManager.id, NOW)).toHaveLength(0);
  });

  it("excludes already approved activities from pending list", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, {
      title: "Approved activity",
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });

    expect(await listApprovalGroups(testDb, manager.id, NOW)).toHaveLength(0);
  });

  it("includes description in group items", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, {
      ...pendingActivityInput("2026-08-19", "Tooling maintenance", manager.id),
      description: "Early wear identified on mold #3.",
    });

    const groups = await listApprovalGroups(testDb, manager.id, NOW);

    expect(groups[0]?.items[0]?.description).toContain("Early wear");
  });
});

describe("batch approval execution", () => {
  it("approves all visible records", async () => {
    const { manager, worker1 } = await setupCompany();
    const item1 = await createActivity(worker1, pendingActivityInput("2026-08-19", "One", manager.id));
    const item2 = await createActivity(worker1, pendingActivityInput("2026-08-19", "Two", manager.id));

    const result = await approveMany(testDb, manager.id, [item1.id, item2.id], NOW);

    expect(result.approved).toBe(2);
    expect(result.skipped).toHaveLength(0);
    const statuses = await testDb.activity.findMany({
      where: { id: { in: [item1.id, item2.id] } },
      select: { approvalStatus: true },
    });
    expect(statuses.every((k) => k.approvalStatus === "APPROVED")).toBe(true);
  });

  it("prevents approving activities assigned to someone else", async () => {
    const { manager, peerManager, worker1 } = await setupCompany();
    const mine = await createActivity(worker1, pendingActivityInput("2026-08-19", "Mine", manager.id));
    const theirs = await createActivity(
      worker1,
      pendingActivityInput("2026-08-19", "Peers", peerManager.id),
    );

    const result = await approveMany(testDb, manager.id, [mine.id, theirs.id], NOW);

    expect(result.approved).toBe(1);
    expect(result.skipped).toHaveLength(1);
    const other = await testDb.activity.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(other.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("excludes records added after manager opened the batch list", async () => {
    const { manager, worker1 } = await setupCompany();
    const visible = await createActivity(
      worker1,
      pendingActivityInput("2026-08-19", "Visible item", manager.id),
    );
    const later = await createActivity(
      worker1,
      pendingActivityInput("2026-08-19", "Later item", manager.id),
    );

    await approveMany(testDb, manager.id, [visible.id], NOW);

    const checkLater = await testDb.activity.findUniqueOrThrow({ where: { id: later.id } });
    expect(checkLater.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("records separate audit log and notification for each approved activity", async () => {
    const { manager, worker1 } = await setupCompany();
    const item1 = await createActivity(worker1, pendingActivityInput("2026-08-19", "One", manager.id));
    const item2 = await createActivity(worker1, pendingActivityInput("2026-08-19", "Two", manager.id));

    await approveMany(testDb, manager.id, [item1.id, item2.id], NOW);

    const auditCount = await testDb.auditLog.count({
      where: {
        action: AUDIT_ACTIONS.activityApproved,
        objectId: { in: [item1.id, item2.id] },
      },
    });
    expect(auditCount).toBe(2);

    const notificationCount = await testDb.notificationQueue.count({
      where: {
        userId: worker1.id,
        eventType: NOTIFICATION_EVENTS.activityApproved,
      },
    });
    expect(notificationCount).toBe(2);
  });

  it("reports items whose status changed as skipped instead of failing silently", async () => {
    const { manager, worker1 } = await setupCompany();
    const item = await createActivity(worker1, pendingActivityInput("2026-08-19", "One", manager.id));
    await approveMany(testDb, manager.id, [item.id], NOW);

    const repeat = await approveMany(testDb, manager.id, [item.id], NOW);

    expect(repeat.approved).toBe(0);
    expect(repeat.skipped.length).toBe(1);
  });
});
