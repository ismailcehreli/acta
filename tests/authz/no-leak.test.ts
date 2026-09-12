import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity, canCancelActivity } from "@/server/activities/cancel";
import { findOwnActivity, listOwnActivities } from "@/server/activities/read";
import { listScopeActivities } from "@/server/activities/scope-feed";
import { updateActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Zero tolerance for authorization leaks (§18.4).
// Uses actual read and write operational paths rather than mock queries.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const SECRET = "CONFIDENTIAL_DO_NOT_LEAK";

async function scenario() {
  const root = await createOrgUnit({ name: "General Directorate", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });
  const it = await createOrgUnit({ name: "IT Dept", parentId: root.id });

  const author = await createUser(moldShop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const peer = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(it.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Mold maintenance",
      description: SECRET,
      approvalStatus: "APPROVED",
    },
  });

  // Tagging department does not grant access (§8.3).
  await testDb.activityTargetDept.create({
    data: { activityId: activity.id, orgUnitId: planning.id },
  });

  return { author, peer, sysAdmin, activity };
}

const unauthorizedRoles = [
  ["peer manager", "peer"],
  ["system admin", "sysAdmin"],
] as const;

describe("list path does not leak", () => {
  it.each(unauthorizedRoles)("%s cannot see another user's activity in list", async (_title, roleKey) => {
    const context = await scenario();
    const viewer = context[roleKey];

    const list = await listOwnActivities(
      testDb,
      { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
      { period: "all", now: new Date() },
    );

    expect(list.map((item) => item.id)).not.toContain(context.activity.id);
    expect(JSON.stringify(list)).not.toContain(SECRET);
  });
});

describe("detail path does not leak", () => {
  it.each(unauthorizedRoles)("%s cannot fetch detail of another user's activity", async (_title, roleKey) => {
    const context = await scenario();
    const viewer = context[roleKey];

    const found = await findOwnActivity(
      testDb,
      { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin },
      context.activity.id,
    );

    expect(found).toBeNull();
  });
});

describe("write paths are protected against unauthorized users", () => {
  it.each(unauthorizedRoles)("%s cannot update another user's activity", async (_title, roleKey) => {
    const context = await scenario();
    const viewer = context[roleKey];

    const result = await updateActivity(
      testDb,
      viewer.id,
      {
        id: context.activity.id,
        activityDate: "2026-08-17",
        title: "Hijacked title",
        description: "Modified description",
        targetDepartmentIds: [context.activity.authorOrgUnitId],
      },
      new Date("2026-08-17T09:05:00.000Z"),
    );

    expect(result.ok).toBe(false);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: context.activity.id },
    });
    expect(stored.title).toBe("Mold maintenance");
  });

  it.each(unauthorizedRoles)("%s cannot cancel another user's activity", async (_title, roleKey) => {
    const context = await scenario();
    const viewer = context[roleKey];
    const actor = { id: viewer.id, isSystemAdmin: viewer.isSystemAdmin };

    expect(await canCancelActivity(testDb, context.activity, actor)).toBe(false);

    const result = await cancelActivity(
      testDb,
      actor,
      context.activity.id,
      "Unauthorized cancellation attempt.",
      new Date("2026-08-17T09:05:00.000Z"),
    );

    expect(result.ok).toBe(false);

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: context.activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
  });
});

describe("scope feed strictly depends on visibility module", () => {
  async function nestedTree() {
    const root = await createOrgUnit({ name: "General Directorate", type: "Root" });
    const moldShop = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

    const moldManager = await createUser(moldShop.id, {
      fullName: "Workshop Manager",
      isUnitManager: true,
    });
    const moldWorker = await createUser(moldShop.id, { fullName: "Workshop Worker" });
    const planningManager = await createUser(planning.id, {
      fullName: "Planning Manager",
      isUnitManager: true,
    });

    const own = await testDb.activity.create({
      data: {
        authorId: moldWorker.id,
        authorOrgUnitId: moldShop.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Team activity",
        description: SECRET,
        approvalStatus: "APPROVED",
      },
    });
    const foreign = await testDb.activity.create({
      data: {
        authorId: planningManager.id,
        authorOrgUnitId: planning.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Peer activity",
        description: SECRET,
        approvalStatus: "APPROVED",
      },
    });

    return { moldManager, own, foreign };
  }

  it("manager only sees activities from their own team", async () => {
    const { moldManager, own, foreign } = await nestedTree();

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: moldManager.id, isSystemAdmin: false },
      { period: "all" },
      new Date("2026-08-17T09:00:00.000Z"),
    );
    const ids = feed.map((item) => item.id);

    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("pending approval activity never leaks into general scope feed", async () => {
    const { moldManager } = await nestedTree();
    const root = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    const stranger = await createUser(root.id, { fullName: "Stranger" });
    const anotherApprover = await createUser(root.id, {
      fullName: "Another Approver",
    });
    const hidden = await testDb.activity.create({
      data: {
        authorId: stranger.id,
        authorOrgUnitId: root.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Pending approval",
        description: SECRET,
        approvalStatus: "PENDING_APPROVAL",
        approverId: anotherApprover.id,
      },
    });

    const { items: feed } = await listScopeActivities(
      testDb,
      { id: moldManager.id, isSystemAdmin: false },
      { period: "all" },
      new Date("2026-08-17T09:00:00.000Z"),
    );

    expect(feed.map((item) => item.id)).not.toContain(hidden.id);
  });
});

describe("author access is preserved", () => {
  it("author sees their own activity in list and detail views", async () => {
    const { author, activity } = await scenario();
    const viewer = { id: author.id, isSystemAdmin: false };

    const list = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: new Date(),
    });
    const detail = await findOwnActivity(testDb, viewer, activity.id);

    expect(list.map((item) => item.id)).toContain(activity.id);
    expect(detail?.description).toBe(SECRET);
  });
});

describe("responses do not disclose existence of activities", () => {
  const NON_EXISTENT_ID = "00000000-0000-0000-0000-000000000000";

  it("update: unauthorized record and non-existent record receive identical response", async () => {
    const { peer, activity } = await scenario();
    const now = new Date("2026-08-17T09:05:00.000Z");

    const input = {
      activityDate: "2026-08-17",
      title: "Attempted title",
      description: "Attempted description",
      targetDepartmentIds: [activity.authorOrgUnitId],
    };

    const unauthorized = await updateActivity(
      testDb,
      peer.id,
      { ...input, id: activity.id },
      now,
    );
    const nonExistent = await updateActivity(
      testDb,
      peer.id,
      { ...input, id: NON_EXISTENT_ID },
      now,
    );

    expect(unauthorized).toEqual(nonExistent);
  });

  it("cancel: unauthorized record and non-existent record receive identical response", async () => {
    const { peer, activity } = await scenario();
    const actor = { id: peer.id, isSystemAdmin: false };
    const now = new Date("2026-08-17T09:05:00.000Z");

    const unauthorized = await cancelActivity(
      testDb,
      actor,
      activity.id,
      "Unauthorized cancel attempt.",
      now,
    );
    const nonExistent = await cancelActivity(
      testDb,
      actor,
      NON_EXISTENT_ID,
      "Unauthorized cancel attempt.",
      now,
    );

    expect(unauthorized.ok).toBe(false);
    expect(nonExistent.ok).toBe(false);
    if (unauthorized.ok || nonExistent.ok) return;
    expect(unauthorized.message).toBe(nonExistent.message);
  });

  it("status of cancelled activity is not disclosed to unauthorized user", async () => {
    const { author, peer, activity } = await scenario();
    const now = new Date("2026-08-17T09:05:00.000Z");

    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Author self-cancel.",
      now,
    );

    const unauthorized = await cancelActivity(
      testDb,
      { id: peer.id, isSystemAdmin: false },
      activity.id,
      "Unauthorized cancel attempt.",
      now,
    );

    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) return;
    expect(unauthorized.message).toBe("Activity not found.");
  });
});
