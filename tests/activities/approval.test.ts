import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveActivity,
  listPendingApprovals,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { canViewActivity } from "@/server/authz/visibility";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { markActivityAsRead } from "@/server/reads/service";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Approval workflow (state machine and permission matrix).
// Unapproved content does not flow to upper management until approved by the manager.

const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const executive = await createOrgUnit({ name: "Executive Directorate", parentId: root.id });
  const tooling = await createOrgUnit({
    name: "Tooling Department",
    parentId: executive.id,
    requiresApproval: true,
  });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: executive.id });

  const boardChair = await createUser(root.id, {
    fullName: "Board Chair",
    isUnitManager: true,
  });
  const ceo = await createUser(executive.id, {
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

  return { boardChair, ceo, manager, employee, peerManager, tooling };
}

function activityInput(title = "Tooling maintenance") {
  return {
    activityDate: "2026-08-18",
    title,
    description: "Weekly maintenance completed.",
    targetDepartmentIds: [] as string[],
  };
}

async function createPendingActivity(
  user: { id: string; orgUnitId: string },
  title?: string,
) {
  const result = await createActivity(
    testDb,
    { id: user.id, orgUnitId: user.orgUnitId, requiresApproval: true },
    activityInput(title),
    NOW,
  );
  if (!result.ok) throw new Error(`setup failed: ${result.message}`);
  return result.activity;
}

describe("initial record state", () => {
  it("creates activity in pending approval state when unit requires approval", async () => {
    const { employee, manager } = await setupCompany();

    const activity = await createPendingActivity(employee);

    expect(activity.approvalStatus).toBe("PENDING_APPROVAL");
    expect(activity.approverId).toBe(manager.id);
  });

  it("creates activity directly as approved when unit does not require approval", async () => {
    const { peerManager } = await setupCompany();

    const result = await createActivity(
      testDb,
      { id: peerManager.id, orgUnitId: peerManager.orgUnitId, requiresApproval: false },
      activityInput(),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("APPROVED");
    expect(result.activity.approverId).toBeNull();
  });

  it("sets status to MANAGER_NOT_FOUND when user has no manager", async () => {
    const isolatedUnit = await createOrgUnit({ name: "Isolated", type: "ROOT" });
    const soloUser = await createUser(isolatedUnit.id, { fullName: "Solo User" });

    const result = await createActivity(
      testDb,
      { id: soloUser.id, orgUnitId: soloUser.orgUnitId, requiresApproval: true },
      activityInput(),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("MANAGER_NOT_FOUND");
  });

  it("enqueues notification for the assigned manager when pending approval", async () => {
    const { employee, manager } = await setupCompany();

    const activity = await createPendingActivity(employee);

    const queue = await testDb.notificationQueue.findMany({
      where: { eventType: NOTIFICATION_EVENTS.approvalPending },
    });
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe(manager.id);
    expect(queue[0].payload).toMatchObject({ activityId: activity.id });
  });
});

describe("visibility during approval workflow", () => {
  it("only allows author and approver to view; peers and higher managers cannot see", async () => {
    const { employee, manager, ceo, boardChair, peerManager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const checkView = async (id: string, isSystemAdmin = false) =>
      canViewActivity(testDb, { id, isSystemAdmin }, activity);

    expect(await checkView(employee.id)).toBe("full");
    expect(await checkView(manager.id)).toBe("full");

    // Unapproved content does not flow up the hierarchy
    expect(await checkView(ceo.id)).toBe("none");
    expect(await checkView(boardChair.id)).toBe("none");
    expect(await checkView(peerManager.id)).toBe("none");
  });

  it("allows higher management to view after activity is approved", async () => {
    const { employee, manager, ceo, boardChair } = await setupCompany();
    const activity = await createPendingActivity(employee);

    await approveActivity(testDb, manager.id, activity.id, NOW);
    const updated = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    for (const viewer of [ceo, boardChair]) {
      expect(
        await canViewActivity(testDb, { id: viewer.id, isSystemAdmin: false }, updated),
      ).toBe("full");
    }
  });
});

describe("approving activities", () => {
  it("allows manager to approve, setting approval status and timestamp", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const result = await approveActivity(testDb, manager.id, activity.id, NOW);

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
    expect(stored.approvalDecidedAt).toEqual(NOW);
  });

  it("prevents unauthorized users from approving", async () => {
    const { employee, ceo, peerManager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    for (const actor of [ceo, peerManager, employee]) {
      const result = await approveActivity(testDb, actor.id, activity.id, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("not_found");
    }

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("rejects duplicate approval attempts", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    await approveActivity(testDb, manager.id, activity.id, NOW);
    const second = await approveActivity(testDb, manager.id, activity.id, NOW);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("wrong_status");
  });

  it("creates audit log and enqueues notification on approval", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    await approveActivity(testDb, manager.id, activity.id, NOW);

    const audit = await testDb.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.activityApproved },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(manager.id);

    const notifications = await testDb.notificationQueue.findMany({
      where: { eventType: NOTIFICATION_EVENTS.activityApproved },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(employee.id);
  });
});

describe("requesting changes and resubmitting", () => {
  it("allows requesting changes with a predefined reason", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const reason = await createApprovalReason("CHANGES_REQUESTED", "Incomplete information");

    const result = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id, note: "Please specify mold IDs." },
      NOW,
    );

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("CHANGES_REQUESTED");
    expect(stored.approvalReasonId).toBe(reason.id);
    expect(stored.approvalReasonNote).toBe("Please specify mold IDs.");
  });

  it("requires a valid category", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const result = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: "11111111-1111-4111-8111-111111111111", note: "Some note" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("reason_required");
  });

  it("allows optional explanatory note", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");

    const result = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id },
      NOW,
    );

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalReasonNote).toBeNull();
  });

  it("cannot use reason from another decision category", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const rejectionReason = await createApprovalReason("REJECTED");

    const result = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: rejectionReason.id },
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  it("cannot select an inactive reason", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await createApprovalReason("CHANGES_REQUESTED");
    await testDb.approvalReason.update({
      where: { id: reason.id },
      data: { isActive: false },
    });

    const result = await requestChanges(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id },
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  it("resubmits to manager queue when author edits and saves", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Tooling maintenance",
        description: "Early wear identified on mold #3.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("PENDING_APPROVAL");
    expect(stored.approvalReasonId).toBeNull();
    expect(stored.approvalReasonNote).toBeNull();
  });

  it("bypasses the standard edit window when changes are requested", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const muchLater = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Tooling maintenance",
        description: "Updated per manager feedback.",
        targetDepartmentIds: [],
      },
      muchLater,
    );

    expect(result.ok).toBe(true);
  });

  it("allows resubmission days later if date is preserved even past retroactive entry limit", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "1",
        description: "Retroactive entry limit in days",
      },
    });

    const fourDaysLater = new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000);
    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Tooling maintenance - updated",
        description: "Changes completed.",
        targetDepartmentIds: [],
      },
      fourDaysLater,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.title).toBe("Tooling maintenance - updated");
    expect(result.activity.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("clears manager read receipt upon resubmission so it appears unread again", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("CHANGES_REQUESTED");

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: manager.id },
    });
    await requestChanges(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    expect(
      await testDb.readReceipt.count({ where: { activityId: activity.id, userId: manager.id } }),
    ).toBe(1);

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Revised activity",
        description: "Updated description.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(true);

    expect(
      await testDb.readReceipt.count({ where: { activityId: activity.id, userId: manager.id } }),
    ).toBe(0);
  });

  it("allows author to edit activity while pending within time window", async () => {
    const { employee } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Edited within window",
        description: "Updated details before manager review.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.title).toBe("Edited within window");
    expect(result.activity.approvalStatus).toBe("PENDING_APPROVAL");

    expect(
      await testDb.approvalRound.count({ where: { activityId: activity.id } }),
    ).toBe(1);
  });

  it("closes edit window for pending activity based on system setting", async () => {
    const { employee } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        ...activityInput(),
        id: activity.id,
        title: "Late update",
      },
      new Date(NOW.getTime() + 16 * 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("window_closed");
  });

  it("prevents author from editing pending activity once manager has read it", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    await markActivityAsRead(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity.id,
      3_000,
      new Date(NOW.getTime() + 2 * 60_000),
    );

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        ...activityInput(),
        id: activity.id,
        title: "Cannot edit after being read",
      },
      new Date(NOW.getTime() + 3 * 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_read");
  });
});

describe("pending approvals queue", () => {
  it("only lists pending items assigned to the current approver", async () => {
    const { employee, manager, peerManager } = await setupCompany();
    const first = await createPendingActivity(employee, "First");
    await createPendingActivity(employee, "Second");

    await approveActivity(testDb, manager.id, first.id, NOW);

    const managerQueue = await listPendingApprovals(testDb, manager.id);
    expect(managerQueue.map((i) => i.title)).toEqual(["Second"]);

    expect(await listPendingApprovals(testDb, peerManager.id)).toEqual([]);
  });
});

describe("rejecting activities", () => {
  it("allows manager to reject activity with a categorized reason", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("REJECTED", "Duplicate record");

    const result = await rejectActivity(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id, note: "Same work logged yesterday." },
      NOW,
    );

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("REJECTED");
    expect(stored.approvalReasonId).toBe(reason.id);
    expect(stored.approvalReasonNote).toBe("Same work logged yesterday.");
    expect(stored.approverId).toBe(manager.id);
  });

  it("prevents rejected activities from flowing up the hierarchy", async () => {
    const { employee, manager, ceo, boardChair } = await setupCompany();
    const activity = await createPendingActivity(employee, "Rejected activity");
    const reason = await createApprovalReason("REJECTED");

    await rejectActivity(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    for (const upper of [ceo, boardChair]) {
      expect(
        await canViewActivity(testDb, { id: upper.id, isSystemAdmin: false }, stored),
      ).toBe("none");
    }

    expect(
      await canViewActivity(testDb, { id: employee.id, isSystemAdmin: false }, stored),
    ).toBe("full");
    expect(
      await canViewActivity(testDb, { id: manager.id, isSystemAdmin: false }, stored),
    ).toBe("full");
  });

  it("prevents rejected activities from being edited", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("REJECTED");
    await rejectActivity(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const result = await updateActivity(
      testDb,
      employee.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Retry",
        description: "Attempting to edit rejected activity.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("rejected");
  });

  it("allows rejecting an activity that had changes requested", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const changeReason = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, manager.id, activity.id, { reasonId: changeReason.id }, NOW);

    const rejectionReason = await createApprovalReason("REJECTED");
    const result = await rejectActivity(
      testDb,
      manager.id,
      activity.id,
      { reasonId: rejectionReason.id },
      NOW,
    );

    expect(result.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("REJECTED");
    expect(stored.approvalReasonId).toBe(rejectionReason.id);
  });

  it("prevents non-approver from rejecting activity", async () => {
    const { employee, ceo } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("REJECTED");

    const result = await rejectActivity(
      testDb,
      ceo.id,
      activity.id,
      { reasonId: reason.id },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  it("prevents rejecting an already approved activity", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    await approveActivity(testDb, manager.id, activity.id, NOW);
    const reason = await createApprovalReason("REJECTED");

    const result = await rejectActivity(
      testDb,
      manager.id,
      activity.id,
      { reasonId: reason.id },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("wrong_status");
  });

  it("requires a reason category when rejecting", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);

    const result = await rejectActivity(
      testDb,
      manager.id,
      activity.id,
      { reasonId: "11111111-1111-4111-8111-111111111111" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("reason_required");
  });

  it("sends notification to author and logs rejection in audit trail", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("REJECTED");

    await rejectActivity(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    const notification = await testDb.notificationQueue.findFirst({
      where: {
        userId: employee.id,
        eventType: NOTIFICATION_EVENTS.activityRejected,
      },
    });
    expect(notification).not.toBeNull();

    const audit = await testDb.auditLog.findFirst({
      where: { objectId: activity.id, action: AUDIT_ACTIONS.activityRejected },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.detail)).toContain(reason.id);
  });

  it("removes rejected activity from pending approvals queue", async () => {
    const { employee, manager } = await setupCompany();
    const activity = await createPendingActivity(employee);
    const reason = await createApprovalReason("REJECTED");

    expect((await listPendingApprovals(testDb, manager.id)).length).toBe(1);

    await rejectActivity(testDb, manager.id, activity.id, { reasonId: reason.id }, NOW);

    expect((await listPendingApprovals(testDb, manager.id)).length).toBe(0);
  });
});
