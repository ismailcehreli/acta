import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  describeScope,
  listScopeActivities,
  listScopePeople,
  periodStart,
} from "@/server/activities/scope-feed";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §13: screen layout is identical across tiers, only scope expands.
// Feed always begins with visibility authorization module filter; filters here
// only narrow the result set (§8.4).

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function buildCompany() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const directorate = await createOrgUnit({ name: "Directorate", parentId: root.id });
  const moldShop = await createOrgUnit({ name: "Tooling Workshop", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: directorate.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const director = await createUser(directorate.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const manager = await createUser(moldShop.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const worker = await createUser(moldShop.id, { fullName: "Tooling Worker" });
  const peerManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  return {
    units: { root, directorate, moldShop, planning },
    generalManager,
    director,
    manager,
    worker,
    peerManager,
  };
}

async function write(
  author: { id: string; orgUnitId: string },
  day: string,
  title: string,
  targetUnitId?: string,
) {
  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title,
      description: "Description",
      approvalStatus: "APPROVED",
    },
  });

  if (targetUnitId) {
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: targetUnitId },
    });
  }

  return activity;
}

describe("scope title expands according to tier (§13)", () => {
  it("user without subordinates has no scope", async () => {
    const { worker } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: worker.id,
      isSystemAdmin: false,
    });

    expect(scope.hasScope).toBe(false);
    expect(scope.personCount).toBe(0);
  });

  it("manager with a single department gets the single-department key", async () => {
    const { manager } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("scopes.myDepartment");
    expect(scope.personCount).toBe(1);
  });

  it("director with multiple departments gets the multi-department key", async () => {
    const { director } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: director.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("scopes.myDepartments");
  });

  it("manager in root unit gets the company-wide key", async () => {
    const { generalManager } = await buildCompany();

    const scope = await describeScope(testDb, {
      id: generalManager.id,
      isSystemAdmin: false,
    });

    expect(scope.label).toBe("scopes.entireCompany");
  });
});

describe("feed is powered by visibility authorization module", () => {
  it("excludes peer manager activities from user scope feed", async () => {
    const { manager, worker, peerManager } = await buildCompany();
    const own = await write(worker, "2026-08-17", "Tooling task");
    const peerActivity = await write(peerManager, "2026-08-17", "Planning task");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );
    const ids = feed.map((item) => item.id);

    expect(ids).toContain(own.id);
    expect(ids).not.toContain(peerActivity.id);
  });

  it("excludes activities pending approval from higher management feed", async () => {
    // Only the active approver sees pending approval activity (§8.2); higher managers do not.
    const { manager, worker, director, generalManager } = await buildCompany();
    const pending = await testDb.activity.create({
      data: {
        authorId: worker.id,
        authorOrgUnitId: worker.orgUnitId,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Pending approval",
        description: "Description",
        approvalStatus: "PENDING_APPROVAL",
        approverId: manager.id,
      },
    });

    // Approvers list created alongside record.
    await testDb.activityApprover.create({
      data: { activityId: pending.id, userId: manager.id },
    });

    for (const viewer of [director, generalManager]) {
      const { items } = await listScopeActivities(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        {},
        NOW,
      );
      expect(items.map((item) => item.id)).not.toContain(pending.id);
    }

    // Appears in approver's feed: it is work awaiting their review.
    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );

    expect(feed.map((item) => item.id)).toContain(pending.id);
  });

  it("filters only narrow results, cannot expose out-of-scope records", async () => {
    const { manager, peerManager, units } = await buildCompany();
    const peerActivity = await write(
      peerManager,
      "2026-08-17",
      "Planning task",
      units.moldShop.id,
    );

    // Even if Tooling Shop target filter is applied, peer record is excluded.
    const { items: feed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { targetOrgUnitId: units.moldShop.id },
      NOW,
    );

    expect(feed.map((item) => item.id)).not.toContain(peerActivity.id);
  });
});

describe("filters", () => {
  it("period filter filters out older records", async () => {
    const { director, worker } = await buildCompany();
    const today = await write(worker, "2026-08-17", "Today's");
    const old = await write(worker, "2026-07-01", "Old");

    const { items: todayItems } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "today" },
      NOW,
    );
    const { items: all } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
    );

    expect(todayItems.map((i) => i.id)).toEqual([today.id]);
    expect(all.map((i) => i.id)).toEqual(
      expect.arrayContaining([today.id, old.id]),
    );
  });

  it("person filter narrows to single author", async () => {
    const { director, worker, manager } = await buildCompany();
    const workerActivity = await write(worker, "2026-08-17", "Worker's task");
    await write(manager, "2026-08-17", "Manager's task");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { authorId: worker.id },
      NOW,
    );

    expect(feed.map((i) => i.id)).toEqual([workerActivity.id]);
  });

  it("target department filter selects tagged activities", async () => {
    const { director, worker, units } = await buildCompany();
    const tagged = await write(
      worker,
      "2026-08-17",
      "Relevant to planning",
      units.planning.id,
    );
    await write(worker, "2026-08-17", "Untagged");

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { targetOrgUnitId: units.planning.id },
      NOW,
    );

    expect(feed.map((i) => i.id)).toEqual([tagged.id]);
  });
});

describe("management view", () => {
  it("excludes manager's own record and list and counter use same set", async () => {
    const { manager, worker } = await buildCompany();
    const workerActivity = await write(worker, "2026-08-17", "Worker's task");
    const managerActivity = await write(manager, "2026-08-17", "Manager's task");
    const selection = { subordinates: [worker.id], managedOnly: true };

    const viewer = { id: manager.id, isSystemAdmin: false };
    const [feed, count] = await Promise.all([
      listScopeActivities(testDb, viewer, { period: "all" }, NOW, selection),
      countScopeActivities(testDb, viewer, { period: "all" }, NOW, selection),
    ]);

    expect(feed.items.map((item) => item.id)).toEqual([workerActivity.id]);
    expect(feed.items.map((item) => item.id)).not.toContain(managerActivity.id);
    expect(count).toBe(feed.items.length);
  });
});

describe("read receipt badge", () => {
  it("user's own read receipt is marked, other's is not visible", async () => {
    const { director, manager, worker } = await buildCompany();
    const activity = await write(worker, "2026-08-17", "Tooling work");

    // Manager read it; should still appear unread in director's feed (§10.3).
    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: manager.id },
    });

    const { items: directorFeed } = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      {},
      NOW,
    );
    expect(directorFeed[0].read).toBe(false);

    const { items: managerFeed } = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      {},
      NOW,
    );
    expect(managerFeed[0].read).toBe(true);
  });
});

describe("unread attention filter", () => {
  it("list and counter use same set of open and unread records", async () => {
    const { manager, worker, peerManager } = await buildCompany();
    const oldest = await write(worker, "2026-08-10", "Old unread");
    const newest = await write(worker, "2026-08-17", "New unread");
    const read = await write(worker, "2026-08-17", "Read record");
    const rejectedReason = await createApprovalReason("REJECTED");
    const rejected = await createActivity(worker, {
      title: "Rejected record",
      approvalStatus: "REJECTED",
      approverId: manager.id,
      approvalReasonId: rejectedReason.id,
      approvalReasonKind: "REJECTED",
    });
    const cancelled = await createActivity(worker, {
      title: "Cancelled record",
      approvalStatus: "CANCELLED",
    });
    const own = await write(manager, "2026-08-17", "Manager's own record");
    const peer = await write(peerManager, "2026-08-17", "Peer record");

    await testDb.readReceipt.create({
      data: { activityId: read.id, userId: manager.id },
    });
    const viewer = { id: manager.id, isSystemAdmin: false };
    const selection = { subordinates: [worker.id], managedOnly: true };
    const [feed, count] = await Promise.all([
      listScopeActivities(
        testDb,
        viewer,
        { period: "all", unreadOnly: true },
        NOW,
        { ...selection, order: "oldest" },
      ),
      countScopeActivities(
        testDb,
        viewer,
        { period: "all", unreadOnly: true },
        NOW,
        selection,
      ),
    ]);

    const ids = feed.items.map((item) => item.id);
    expect(ids).toEqual([oldest.id, newest.id]);
    expect(count).toBe(feed.items.length);
    expect(ids).not.toContain(rejected.id);
    expect(ids).not.toContain(cancelled.id);
    expect(ids).not.toContain(peer.id);

    // Even without managed selection, manager's own activity does not enter unread work queue.
    const allVisible = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", unreadOnly: true },
      NOW,
      { order: "oldest" },
    );
    expect(allVisible.items.map((item) => item.id)).not.toContain(own.id);
  });

  it("same activity read by one user remains unread for another", async () => {
    const { director, manager, worker } = await buildCompany();
    const activity = await write(worker, "2026-08-17", "Person specific unread");

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: manager.id },
    });

    const managerFeed = await listScopeActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      { period: "all", unreadOnly: true },
      NOW,
      { subordinates: [worker.id], managedOnly: true, order: "oldest" },
    );
    const directorFeed = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all", unreadOnly: true },
      NOW,
      {
        subordinates: [manager.id, worker.id],
        managedOnly: true,
        order: "oldest",
      },
    );

    expect(managerFeed.items.map((item) => item.id)).not.toContain(activity.id);
    expect(directorFeed.items.map((item) => item.id)).toContain(activity.id);
  });
});

describe("filter options", () => {
  it("person list only contains users within scope", async () => {
    const { manager, worker, peerManager } = await buildCompany();

    const people = await listScopePeople(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const ids = people.map((p) => p.id);

    expect(ids).toContain(worker.id);
    expect(ids).not.toContain(peerManager.id);
    expect(ids).not.toContain(manager.id);
  });
});

describe("period boundary computed from company timezone", () => {
  it("advances 'today' to new day once midnight passes in Istanbul", () => {
    // August 17 21:30 UTC = August 18 00:30 Istanbul.
    const start = periodStart("today", new Date("2026-08-17T21:30:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("keeps 'today' as same day during daytime hours", () => {
    const start = periodStart("today", new Date("2026-08-18T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("'this week' starts on Monday, not sliding 7 days", () => {
    // August 19, 2026 Wednesday; start of week is August 17 Monday.
    const start = periodStart("week", new Date("2026-08-19T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("Sunday is still in the same week", () => {
    // August 23, 2026 Sunday.
    const start = periodStart("week", new Date("2026-08-23T09:00:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("Monday midnight starts new week", () => {
    // August 16 21:30 UTC = August 17 00:30 Istanbul, Monday.
    const start = periodStart("week", new Date("2026-08-16T21:30:00.000Z"));

    expect(start?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("'all' sets no period boundary", () => {
    expect(periodStart("all", new Date("2026-08-18T09:00:00.000Z"))).toBeNull();
  });
});
