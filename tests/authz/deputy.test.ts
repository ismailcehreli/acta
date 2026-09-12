import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, listPendingApprovals } from "@/server/activities/approval";
import { listApprovalGroups } from "@/server/activities/approval-groups";
import { createActivity } from "@/server/activities/write";
import {
  cancelNoActivityPeriod,
  markNoActivityPeriod,
} from "@/server/absence/service";
import { activeDeputyFor } from "@/server/authz/deputy";
import { canViewActivity, visibleActivityWhere } from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// DEPUTY ACCESS RULES (§4.5)
//
// Deputy roles operate under two distinct modes:
// 1. During active deputy period:
//    - The deputy sees activities belonging to the deputized unit within that timeframe.
//    - The deputy can decide on activities awaiting approval in that person's queue.
// 2. After deputy period expires:
//    - The deputy retains read access to activities created during the deputized period.
//
// Crucial constraint: The deputy's historical read window must NEVER leak older records
// from prior to the deputy period.

const DURING_LEAVE = new Date("2026-08-22T09:00:00.000Z");
const AFTER_LEAVE = new Date("2026-09-15T09:00:00.000Z");
/** An old record created months before the deputy period; must remain outside the window. */
const OLD_RECORD = new Date("2026-01-15T09:00:00.000Z");

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

/**
 * Company structure:
 *   Acta HQ (root)
 *     ├─ generalManager (root manager)
 *     ├─ Workshop (requires approval)
 *         ├─ workshopManager (manager — takes leave)
 *         └─ workshopWorker  (worker)
 *     └─ Planning
 *         └─ planningManager (manager — becomes deputy)
 */
async function setupCompany() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  const workshop = await createOrgUnit({
    name: "Workshop",
    parentId: root.id,
    requiresApproval: true,
  });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const generalManager = await createUser(root.id, {
    email: "gm@example.test",
    isUnitManager: true,
  });
  const workshopManager = await createUser(workshop.id, {
    email: "workshop-mgr@example.test",
    isUnitManager: true,
  });
  const workshopWorker = await createUser(workshop.id, { email: "worker@example.test" });
  const planningManager = await createUser(planning.id, {
    email: "planning-mgr@example.test",
    isUnitManager: true,
  });

  return { generalManager, workshopManager, workshopWorker, planningManager };
}

/** General manager marks leave for workshop manager and assigns planning manager as deputy. */
async function setupDeputy(users: Awaited<ReturnType<typeof setupCompany>>) {
  const result = await markNoActivityPeriod(
    testDb,
    users.generalManager.id,
    {
      userId: users.workshopManager.id,
      startDate: "2026-08-20",
      endDate: "2026-08-27",
      deputyId: users.planningManager.id,
    },
    DURING_LEAVE,
  );

  if (!result.ok) throw new Error(`Failed to setup deputy: ${result.message}`);
  return result;
}

async function logActivity(author: { id: string; orgUnitId: string }, now: Date) {
  const result = await createActivity(
    testDb,
    { id: author.id, orgUnitId: author.orgUnitId, requiresApproval: true },
    {
      activityDate: now.toISOString().slice(0, 10),
      title: "Mold maintenance",
      description: "Maintenance performed on 3 presses.",
      targetDepartmentIds: [],
    },
    now,
  );

  if (!result.ok) throw new Error(`Failed to create activity: ${result.error}`);
  return result.activity;
}

async function isInList(viewerUser: { id: string }, activityId: string, now: Date) {
  const where = await visibleActivityWhere(testDb, viewer(viewerUser), undefined, now);
  const rows = await testDb.activity.findMany({ where, select: { id: true } });
  return rows.some((row) => row.id === activityId);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("who can be assigned as deputy", () => {
  it("cannot assign a deputy for a non-manager user", async () => {
    const users = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      users.workshopManager.id,
      {
        userId: users.workshopWorker.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: users.workshopManager.id,
      },
      DURING_LEAVE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("absent_not_manager");
  });

  it("the deputy must also be a manager", async () => {
    const users = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      users.generalManager.id,
      {
        userId: users.workshopManager.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: users.workshopWorker.id,
      },
      DURING_LEAVE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("deputy_not_manager");
  });

  it("leave without deputy can be created for non-managers", async () => {
    const users = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      users.workshopManager.id,
      {
        userId: users.workshopWorker.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
      },
      DURING_LEAVE,
    );

    expect(result.ok).toBe(true);
  });
});

describe("during active deputy period", () => {
  it("deputy sees deputized unit's activity and can approve it", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    expect(activity.approvalStatus).toBe("PENDING_APPROVAL");

    // Normally planning manager never sees workshop activities.
    expect(await isInList(users.planningManager, activity.id, DURING_LEAVE)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(users.planningManager),
        { id: activity.id, authorId: activity.authorId, approvalStatus: activity.approvalStatus },
        undefined,
        DURING_LEAVE,
      ),
    ).toBe("full");

    // Must also appear in pending approvals queue.
    const queue = await listPendingApprovals(testDb, users.planningManager.id, DURING_LEAVE);
    expect(queue.map((item) => item.id)).toContain(activity.id);

    const decision = await approveActivity(
      testDb,
      users.planningManager.id,
      activity.id,
      DURING_LEAVE,
    );
    expect(decision.ok).toBe(true);
  });

  it("decision records audit trail as 'deputy on behalf of manager'", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    await approveActivity(testDb, users.planningManager.id, activity.id, DURING_LEAVE);

    const logEntry = await testDb.auditLog.findFirst({
      where: { objectId: activity.id, action: "activity_approved" },
    });

    // Performed by deputy, on behalf of the deputized manager.
    expect(logEntry?.userId).toBe(users.planningManager.id);
    expect(logEntry?.actualUserId).toBe(users.workshopManager.id);
  });

  it("manager on leave retains authority", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);

    // Deputy augments access, does not revoke manager's permissions.
    const queue = await listPendingApprovals(testDb, users.workshopManager.id, DURING_LEAVE);
    expect(queue.map((item) => item.id)).toContain(activity.id);
  });

  it("sends notification to deputy as well", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);

    for (const user of [users.workshopManager, users.planningManager]) {
      const rows = await testDb.notificationQueue.findMany({
        where: { userId: user.id, eventType: "approval_pending" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toMatchObject({ activityId: activity.id });
    }
  });
});

describe("visibility window does not spill outside deputy period", () => {
  it("activity from BEFORE deputy period remains hidden even while deputy is active", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    // Activity created 7 months prior and approved.
    const oldActivity = await logActivity(users.workshopWorker, OLD_RECORD);
    await testDb.activity.update({
      where: { id: oldActivity.id },
      data: { approvalStatus: "APPROVED" },
    });

    expect(await isInList(users.planningManager, oldActivity.id, DURING_LEAVE)).toBe(false);
    expect(await isInList(users.planningManager, oldActivity.id, AFTER_LEAVE)).toBe(false);
  });

  it("activity from AFTER deputy period remains hidden", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const futureActivity = await logActivity(users.workshopWorker, AFTER_LEAVE);
    await testDb.activity.update({
      where: { id: futureActivity.id },
      data: { approvalStatus: "APPROVED" },
    });

    expect(await isInList(users.planningManager, futureActivity.id, AFTER_LEAVE)).toBe(false);
  });

  it("other non-deputized departments remain hidden", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const gmRecord = await logActivity(users.generalManager, DURING_LEAVE);
    expect(await isInList(users.planningManager, gmRecord.id, DURING_LEAVE)).toBe(false);
  });
});

describe("deputy period record cannot be physically deleted", () => {
  it("when deputy period expires, record stays intact; window remains open", async () => {
    const users = await setupCompany();
    const setup = await setupDeputy(users);
    if (!setup.ok) throw new Error("setup");

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    await approveActivity(testDb, users.planningManager.id, activity.id, DURING_LEAVE);
    expect(await isInList(users.planningManager, activity.id, AFTER_LEAVE)).toBe(true);

    // Physical delete rejected at database level.
    await expect(
      testDb.noActivityPeriod.delete({ where: { id: setup.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(await isInList(users.planningManager, activity.id, AFTER_LEAVE)).toBe(true);
  });

  it("cancellation with reason revokes deputy window", async () => {
    const users = await setupCompany();
    const setup = await setupDeputy(users);
    if (!setup.ok) throw new Error("setup");

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    expect(await isInList(users.planningManager, activity.id, DURING_LEAVE)).toBe(true);

    const cancelResult = await cancelNoActivityPeriod(
      testDb,
      users.generalManager.id,
      setup.id,
      "entered by mistake",
      DURING_LEAVE,
    );
    expect(cancelResult.ok).toBe(true);

    expect(await isInList(users.planningManager, activity.id, DURING_LEAVE)).toBe(false);
    expect(await activeDeputyFor(testDb, users.planningManager.id, DURING_LEAVE)).toEqual([]);

    const queue = await listPendingApprovals(testDb, users.planningManager.id, DURING_LEAVE);
    expect(queue.map((item) => item.id)).not.toContain(activity.id);

    const groups = await listApprovalGroups(testDb, users.planningManager.id, DURING_LEAVE);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).not.toContain(activity.id);
  });
});

describe("after deputy period ends", () => {
  it("activities from that period remain visible", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    await approveActivity(testDb, users.planningManager.id, activity.id, DURING_LEAVE);

    // Deputy period expired; active scope closed but read window persists.
    expect(await activeDeputyFor(testDb, users.planningManager.id, AFTER_LEAVE)).toEqual([]);
    expect(await isInList(users.planningManager, activity.id, AFTER_LEAVE)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(users.planningManager),
        { id: activity.id, authorId: activity.authorId, approvalStatus: "APPROVED" },
        undefined,
        AFTER_LEAVE,
      ),
    ).toBe("full");
  });

  it("activity from period remains visible even if approved by someone else", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    const decision = await approveActivity(
      testDb,
      users.workshopManager.id,
      activity.id,
      DURING_LEAVE,
    );
    expect(decision.ok).toBe(true);

    expect(await isInList(users.planningManager, activity.id, AFTER_LEAVE)).toBe(true);
    expect(
      await canViewActivity(
        testDb,
        viewer(users.planningManager),
        { id: activity.id, authorId: activity.authorId, approvalStatus: "APPROVED" },
        undefined,
        AFTER_LEAVE,
      ),
    ).toBe("full");
  });

  it("pending activity that was not approved during period becomes inaccessible once period ends", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const activity = await logActivity(users.workshopWorker, DURING_LEAVE);
    expect(await isInList(users.planningManager, activity.id, DURING_LEAVE)).toBe(true);

    expect(await isInList(users.planningManager, activity.id, AFTER_LEAVE)).toBe(false);
  });

  it("activity decided by deputy remains permanently visible to that deputy", async () => {
    const users = await setupCompany();
    await setupDeputy(users);

    const inheritedActivity = await logActivity(users.workshopWorker, OLD_RECORD);
    const decision = await approveActivity(
      testDb,
      users.planningManager.id,
      inheritedActivity.id,
      DURING_LEAVE,
    );
    expect(decision.ok).toBe(true);

    expect(await isInList(users.planningManager, inheritedActivity.id, AFTER_LEAVE)).toBe(true);
  });
});
