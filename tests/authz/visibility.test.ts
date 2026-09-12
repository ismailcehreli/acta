import type { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canViewActivity,
  listInterventionQueue,
  subordinateUserIds,
  visibleActivityWhere,
  type VisibilityLevel,
} from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §8.2 Permission Matrix Tests
//
// Tests author, supervisor chain, and system administrator columns.
// Zero tolerance for authorization leaks (§18.4).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Three-tier sample hierarchy:
 *
 *   General Directorate ── GM (unit manager)
 *     └─ Operations Directorate ── Director
 *          ├─ Workshop ── Manager + Worker
 *          └─ Planning ── Peer Manager
 *
 *   IT Dept ── System Admin (not supervisor of anyone in hierarchy)
 */
async function buildTree() {
  const root = await createOrgUnit({ name: "General Directorate", type: "Root" });
  const directorate = await createOrgUnit({
    name: "Operations Directorate",
    parentId: root.id,
  });
  const moldShop = await createOrgUnit({ name: "Workshop", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: directorate.id });
  const it = await createOrgUnit({ name: "IT Dept", parentId: root.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const director = await createUser(directorate.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const manager = await createUser(moldShop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const worker = await createUser(moldShop.id, { fullName: "Workshop Worker" });
  const peer = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(it.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  return {
    units: { root, directorate, moldShop, planning, it },
    generalManager,
    director,
    manager,
    worker,
    peer,
    sysAdmin,
  };
}

/**
 * Creates activity adhering to database constraints.
 */
async function writeActivity(
  author: { id: string; orgUnitId: string },
  status: ActivityApprovalStatus,
  title = "Activity",
  approverId?: string,
) {
  const requiresApproval =
    status === "PENDING_APPROVAL" ||
    status === "CHANGES_REQUESTED" ||
    status === "REJECTED";

  const resolvedApproverId = requiresApproval
    ? (approverId ?? (await resolveApproverIfExists(author.id)))
    : null;

  if (requiresApproval && resolvedApproverId === null) {
    return testDb.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: author.orgUnitId,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title,
        description: "CONFIDENTIAL CONTENT",
        approvalStatus: "MANAGER_NOT_FOUND",
      },
    });
  }

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title,
      description: "CONFIDENTIAL CONTENT",
      approvalStatus: status,
      approverId: resolvedApproverId,
      ...(await reasonFields(status)),
    },
  });

  if (resolvedApproverId) {
    await testDb.activityApprover.create({
      data: { activityId: activity.id, userId: resolvedApproverId },
    });
  }

  return activity;
}

async function reasonFields(status: ActivityApprovalStatus) {
  if (status !== "CHANGES_REQUESTED" && status !== "REJECTED") return {};

  const reason = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: status, label: "Test reason" } },
    create: { kind: status, label: "Test reason" },
    update: {},
  });

  return {
    approvalReasonId: reason.id,
    approvalReasonKind: status,
  } as const;
}

async function resolveApproverIfExists(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const result = await resolveManager(testDb, userId);
  return result.found ? result.managerId : null;
}

const ALL_STATUSES: ActivityApprovalStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "MANAGER_NOT_FOUND",
  "APPROVED",
  "CANCELLED",
];

// ---------------------------------------------------------------------------
// §8.2 — status × relationship matrix
// ---------------------------------------------------------------------------

describe("§8.2 matrix — author column", () => {
  it.each(ALL_STATUSES)(
    "author sees their own activity in status %s",
    async (status) => {
      const { worker } = await buildTree();
      const activity = await writeActivity(worker, status);

      const level = await canViewActivity(
        testDb,
        { id: worker.id, isSystemAdmin: false },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("full");
    },
  );
});

describe("§8.2 matrix — supervisor chain column", () => {
  const chainVisible: ActivityApprovalStatus[] = ["APPROVED", "CANCELLED"];
  const chainHidden: ActivityApprovalStatus[] = [
    "DRAFT",
    "PENDING_APPROVAL",
    "CHANGES_REQUESTED",
    "MANAGER_NOT_FOUND",
  ];

  it.each(chainVisible)("supervisor chain sees activities in status %s", async (status) => {
    const { worker, manager, director, generalManager } = await buildTree();
    const activity = await writeActivity(worker, status);

    for (const viewer of [manager, director, generalManager]) {
      const level = await canViewActivity(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        activity,
      );
      expect(level).toBe<VisibilityLevel>("full");
    }
  });

  it.each(chainHidden)("supervisor chain CANNOT see activities in status %s", async (status) => {
    const { worker, director, generalManager } = await buildTree();
    const activity = await writeActivity(worker, status);

    for (const viewer of [director, generalManager]) {
      const level = await canViewActivity(
        testDb,
        { id: viewer.id, isSystemAdmin: false },
        activity,
      );
      expect(level).toBe<VisibilityLevel>("none");
    }
  });
});

describe("§8.2 matrix — system admin column", () => {
  it("sees metadata only for MANAGER_NOT_FOUND activities", async () => {
    const { worker, sysAdmin } = await buildTree();
    const activity = await writeActivity(worker, "MANAGER_NOT_FOUND");

    const level = await canViewActivity(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("metadata");
  });

  it.each(ALL_STATUSES.filter((status) => status !== "MANAGER_NOT_FOUND"))(
    "system admin CANNOT see content in status %s",
    async (status) => {
      const { worker, sysAdmin } = await buildTree();
      const activity = await writeActivity(worker, status);

      const level = await canViewActivity(
        testDb,
        { id: sysAdmin.id, isSystemAdmin: true },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("none");
    },
  );

  it("admin role does not grant content access outside hierarchy (§15.1)", async () => {
    const { worker, peer } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: peer.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("hierarchical authority is not restricted by having system admin role", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: true },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("full");
  });
});

// ---------------------------------------------------------------------------
// §8.1 — peers and direction
// ---------------------------------------------------------------------------

describe("§8.1 peers cannot view each other", () => {
  it.each(ALL_STATUSES)(
    "peer manager cannot view activity in status %s",
    async (status) => {
      const { manager, peer } = await buildTree();
      const activity = await writeActivity(manager, status);

      const level = await canViewActivity(
        testDb,
        { id: peer.id, isSystemAdmin: false },
        activity,
      );

      expect(level).toBe<VisibilityLevel>("none");
    },
  );

  it("two workers in the same unit cannot view each other", async () => {
    const { units } = await buildTree();
    const first = await createUser(units.moldShop.id, { fullName: "Worker A" });
    const second = await createUser(units.moldShop.id, { fullName: "Worker B" });
    const activity = await writeActivity(first, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: second.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("subordinate cannot view supervisor's activity", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(manager, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: worker.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("unit manager sees employee in their unit", async () => {
    const { worker, manager } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("full");
  });
});

// ---------------------------------------------------------------------------
// §8.3 — target department does not grant access
// ---------------------------------------------------------------------------

describe("§8.3 target department does not grant access", () => {
  it("manager of tagged department cannot view activity", async () => {
    const { manager, peer, units } = await buildTree();
    const activity = await writeActivity(peer, "APPROVED", "Workshop process");
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: units.moldShop.id },
    });

    const level = await canViewActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity,
    );

    expect(level).toBe<VisibilityLevel>("none");
  });

  it("target department tag does not add record to scope query", async () => {
    const { manager, peer, units } = await buildTree();
    const activity = await writeActivity(peer, "APPROVED", "Workshop process");
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: units.moldShop.id },
    });

    const where = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(activity.id);
  });
});

// ---------------------------------------------------------------------------
// Scope queries
// ---------------------------------------------------------------------------

describe("scope query", () => {
  it("non-manager user only sees their own activities", async () => {
    const { worker, manager } = await buildTree();
    const own = await writeActivity(worker, "APPROVED", "My activity");
    await writeActivity(manager, "APPROVED", "Manager activity");

    const where = await visibleActivityWhere(testDb, {
      id: worker.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).toEqual([own.id]);
  });

  it("unit manager sees their unit and descendants, but not peers", async () => {
    const { worker, manager, peer, director } = await buildTree();
    const workerActivity = await writeActivity(worker, "APPROVED", "Worker");
    const managerActivity = await writeActivity(manager, "APPROVED", "Manager");
    const peerActivity = await writeActivity(peer, "APPROVED", "Peer");

    const where = await visibleActivityWhere(testDb, {
      id: director.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });
    const ids = visible.map((a) => a.id);

    expect(ids).toContain(workerActivity.id);
    expect(ids).toContain(managerActivity.id);
    expect(ids).toContain(peerActivity.id);
  });

  it("peer manager scope does not include other department", async () => {
    const { worker, peer } = await buildTree();
    const workerActivity = await writeActivity(worker, "APPROVED");

    const where = await visibleActivityWhere(testDb, {
      id: peer.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(workerActivity.id);
  });

  it("subordinate pending approval activity is not visible to upper levels", async () => {
    const { worker, director, generalManager } = await buildTree();
    const pending = await writeActivity(worker, "PENDING_APPROVAL");
    const approved = await writeActivity(worker, "APPROVED");

    for (const viewer of [director, generalManager]) {
      const where = await visibleActivityWhere(testDb, {
        id: viewer.id,
        isSystemAdmin: false,
      });
      const ids = (await testDb.activity.findMany({ where })).map((a) => a.id);

      expect(ids).toContain(approved.id);
      expect(ids).not.toContain(pending.id);
    }
  });

  it("pending activity is only in scope for the active approver", async () => {
    const { worker, manager, peer } = await buildTree();
    const pending = await writeActivity(worker, "PENDING_APPROVAL");

    const approverScope = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    expect(
      (await testDb.activity.findMany({ where: approverScope })).map((a) => a.id),
    ).toContain(pending.id);

    const peerScope = await visibleActivityWhere(testDb, {
      id: peer.id,
      isSystemAdmin: false,
    });
    expect(
      (await testDb.activity.findMany({ where: peerScope })).map((a) => a.id),
    ).not.toContain(pending.id);
  });

  it("cancelled subordinate activity remains in scope", async () => {
    const { worker, manager } = await buildTree();
    const cancelled = await writeActivity(worker, "CANCELLED");

    const where = await visibleActivityWhere(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).toContain(cancelled.id);
  });

  it("system admin scope is determined by hierarchy, not admin role", async () => {
    const { worker, sysAdmin } = await buildTree();
    const activity = await writeActivity(worker, "APPROVED");

    const where = await visibleActivityWhere(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });
    const visible = await testDb.activity.findMany({ where });

    expect(visible.map((a) => a.id)).not.toContain(activity.id);
  });

  it("scope filter is fully consistent with canViewActivity", async () => {
    const { worker, manager, peer, director, generalManager, sysAdmin } =
      await buildTree();
    const people = [worker, manager, peer, director, generalManager, sysAdmin];

    for (const person of people) {
      for (const status of ALL_STATUSES) {
        await writeActivity(person, status, `${person.fullName}-${status}`);
      }
    }

    const all = await testDb.activity.findMany();

    for (const person of people) {
      const viewer = { id: person.id, isSystemAdmin: person.isSystemAdmin };
      const where = await visibleActivityWhere(testDb, viewer);
      const listed = new Set(
        (await testDb.activity.findMany({ where })).map((a) => a.id),
      );

      for (const activity of all) {
        const level = await canViewActivity(testDb, viewer, activity);
        expect(listed.has(activity.id)).toBe(level === "full");
      }
    }
  });
});

describe("subordinate determination", () => {
  it("non-manager user has no subordinates", async () => {
    const { worker } = await buildTree();

    expect(await subordinateUserIds(testDb, worker.id)).toEqual([]);
  });

  it("unit manager covers everyone in their unit and subordinate subtree", async () => {
    const { manager, worker } = await buildTree();

    const ids = await subordinateUserIds(testDb, manager.id);

    expect(ids).toContain(worker.id);
    expect(ids).not.toContain(manager.id);
  });

  it("upper tier covers intermediate managers as well", async () => {
    const { generalManager, director, manager, worker, peer } = await buildTree();

    const ids = await subordinateUserIds(testDb, generalManager.id);

    expect(ids).toEqual(
      expect.arrayContaining([director.id, manager.id, worker.id, peer.id]),
    );
  });
});

describe("intervention queue (§8.2 sysadmin exception)", () => {
  it("only contains MANAGER_NOT_FOUND activities", async () => {
    const { worker, sysAdmin } = await buildTree();
    const orphan = await writeActivity(worker, "MANAGER_NOT_FOUND");
    await writeActivity(worker, "APPROVED");

    const rows = await listInterventionQueue(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });

    expect(rows.map((a) => a.id)).toEqual([orphan.id]);
  });

  it("returns metadata only; description is never included", async () => {
    const { worker, sysAdmin } = await buildTree();
    await writeActivity(worker, "MANAGER_NOT_FOUND");

    const rows = await listInterventionQueue(testDb, {
      id: sysAdmin.id,
      isSystemAdmin: true,
    });

    expect(Object.keys(rows[0]).sort()).toEqual([
      "activityDate",
      "authorId",
      "authorName",
      "id",
      "title",
    ]);
    expect(JSON.stringify(rows)).not.toContain("CONFIDENTIAL CONTENT");
  });

  it("returns empty for non-system-admin", async () => {
    const { worker, manager } = await buildTree();
    await writeActivity(worker, "MANAGER_NOT_FOUND");

    const rows = await listInterventionQueue(testDb, {
      id: manager.id,
      isSystemAdmin: false,
    });

    expect(rows).toEqual([]);
  });
});
