import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listProfileActivities, loadProfile } from "@/server/users/profile";

import {
  createApprovalReason,
  createActivity,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// User profile and activity archive tests.
// Access and statistics are strictly governed by the visibility authorization layer.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const production = await createOrgUnit({ name: "Production", parentId: root.id });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: production.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    email: "gm@example.test",
    isUnitManager: true,
  });
  const manager = await createUser(production.id, {
    fullName: "Production Manager",
    email: "manager@example.test",
    isUnitManager: true,
  });
  const teamMember = await createUser(production.id, {
    fullName: "Production Worker",
    email: "worker@example.test",
  });
  const worker = await createUser(tooling.id, {
    fullName: "Tooling Worker",
    email: "tooling@example.test",
  });
  const outsider = await createUser(root.id, {
    fullName: "External User",
    email: "external@example.test",
  });

  return { root, production, tooling, generalManager, manager, teamMember, worker, outsider };
}

const viewer = (
  id: string,
  isSystemAdmin = false,
  extra: { orgUnitId?: string; isUnitManager?: boolean } = {},
) => ({ id, isSystemAdmin, ...extra });

describe("profile view authorization", () => {
  it("allows user to view their own profile", async () => {
    const { worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(worker.id), worker.id, NOW);

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.person.fullName).toBe("Tooling Worker");
    expect(result.person.orgUnitName).toBe("Tooling");
  });

  it("allows manager to view subordinate profile", async () => {
    const { manager, worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(manager.id), worker.id, NOW);

    expect(result.access).toBe("full");
  });

  it("prevents subordinate from viewing manager profile", async () => {
    const { manager, worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(worker.id), manager.id, NOW);

    expect(result.access).toBe("none");
  });

  it("allows system admin to access user metadata", async () => {
    const { outsider, worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(outsider.id, true), worker.id, NOW);

    expect(result.access).toBe("metadata");
    if (result.access !== "metadata") return;
    expect(result.person.fullName).toBe("Tooling Worker");
  });

  it("prevents arbitrary external user from viewing profile", async () => {
    const { outsider, worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(outsider.id, false), worker.id, NOW);

    expect(result.access).toBe("none");
  });

  it("prevents peer manager from viewing profile outside their branch", async () => {
    const { root, worker } = await setupCompany();
    const planning = await createOrgUnit({ name: "Planning", parentId: root.id });
    const peerManager = await createUser(planning.id, { isUnitManager: true });

    const result = await loadProfile(testDb, viewer(peerManager.id), worker.id, NOW);

    expect(result.access).toBe("none");
  });
});

describe("last login visibility rules", () => {
  it("allows user to see their own last login date", async () => {
    const { worker } = await setupCompany();
    const lastLogin = new Date("2026-08-18T08:30:00.000Z");
    await testDb.user.update({ where: { id: worker.id }, data: { lastLoginAt: lastLogin } });

    const result = await loadProfile(testDb, viewer(worker.id), worker.id, NOW);

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.person.lastLoginVisible).toBe(true);
    expect(result.person.lastLoginAt).toEqual(lastLogin);
  });

  it("allows manager to view last login of employees in same department", async () => {
    const { manager, teamMember } = await setupCompany();
    const lastLogin = new Date("2026-08-18T08:15:00.000Z");
    await testDb.user.update({
      where: { id: teamMember.id },
      data: { lastLoginAt: lastLogin },
    });

    const result = await loadProfile(
      testDb,
      viewer(manager.id, false, { orgUnitId: manager.orgUnitId, isUnitManager: true }),
      teamMember.id,
      NOW,
    );

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.person.lastLoginVisible).toBe(true);
    expect(result.person.lastLoginAt).toEqual(lastLogin);
  });

  it("hides last login when viewing subordinate in a sub-department", async () => {
    const { manager, worker } = await setupCompany();
    const lastLogin = new Date("2026-08-18T08:45:00.000Z");
    await testDb.user.update({ where: { id: worker.id }, data: { lastLoginAt: lastLogin } });

    const result = await loadProfile(
      testDb,
      viewer(manager.id, false, { orgUnitId: manager.orgUnitId, isUnitManager: true }),
      worker.id,
      NOW,
    );

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.person.lastLoginVisible).toBe(false);
    expect(result.person.lastLoginAt).toBeNull();
  });

  it("allows system admin to view last login info", async () => {
    const { outsider, worker } = await setupCompany();
    const lastLogin = new Date("2026-08-18T09:00:00.000Z");
    await testDb.user.update({ where: { id: worker.id }, data: { lastLoginAt: lastLogin } });

    const result = await loadProfile(testDb, viewer(outsider.id, true), worker.id, NOW);

    expect(result.access).toBe("metadata");
    if (result.access !== "metadata") return;
    expect(result.person.lastLoginVisible).toBe(true);
    expect(result.person.lastLoginAt).toEqual(lastLogin);
  });
});

describe("statistics bounded by viewer authorization", () => {
  it("excludes unapproved activities from higher manager stats count", async () => {
    const { generalManager, manager, worker } = await setupCompany();

    await createActivity(worker, {
      title: "Approved task",
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });
    await createActivity(worker, {
      title: "Pending task",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const managerView = await loadProfile(testDb, viewer(manager.id), worker.id, NOW);
    const gmView = await loadProfile(testDb, viewer(generalManager.id), worker.id, NOW);

    expect(managerView.access).toBe("full");
    if (managerView.access !== "full") return;
    expect(managerView.stats.total).toBe(2);
    expect(managerView.stats.pending).toBe(1);

    expect(gmView.access).toBe("full");
    if (gmView.access !== "full") return;
    expect(gmView.stats.total).toBe(1);
    expect(gmView.stats.pending).toBe(0);
  });

  it("includes cancelled activities in author's own total stats", async () => {
    const { worker, manager } = await setupCompany();
    await createActivity(worker, { approvalStatus: "APPROVED", approverId: manager.id });
    await createActivity(worker, { approvalStatus: "CANCELLED", approverId: manager.id });

    const result = await loadProfile(testDb, viewer(worker.id), worker.id, NOW);

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.stats.total).toBe(2);
  });

  it("calculates this-month activities accurately", async () => {
    const { worker, manager } = await setupCompany();
    await createActivity(worker, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });
    await createActivity(worker, {
      activityDate: new Date("2026-07-28T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });

    const result = await loadProfile(testDb, viewer(worker.id), worker.id, NOW);

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.stats.total).toBe(2);
    expect(result.stats.thisMonth).toBe(1);
    expect(result.stats.lastActivityDate?.toISOString()).toContain("2026-08-03");
  });

  it("returns null lastActivityDate when user has no activities", async () => {
    const { worker } = await setupCompany();

    const result = await loadProfile(testDb, viewer(worker.id), worker.id, NOW);

    expect(result.access).toBe("full");
    if (result.access !== "full") return;
    expect(result.stats.total).toBe(0);
    expect(result.stats.lastActivityDate).toBeNull();
  });
});

describe("profile activities archive list", () => {
  it("excludes unapproved activities from unauthorized viewers in archive", async () => {
    const { generalManager, manager, worker } = await setupCompany();
    await createActivity(worker, {
      title: "Publicly visible",
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });
    await createActivity(worker, {
      title: "Unapproved draft",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const gmList = await listProfileActivities(testDb, viewer(generalManager.id), worker.id);

    expect(gmList.map((k) => k.title)).toEqual(["Publicly visible"]);
  });

  it("allows author to see their pending activities in profile archive", async () => {
    const { worker, manager } = await setupCompany();
    await createActivity(worker, {
      title: "Own pending task",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const list = await listProfileActivities(testDb, viewer(worker.id), worker.id);

    expect(list.map((k) => k.title)).toEqual(["Own pending task"]);
  });

  it("allows active approver to see pending activities in profile archive", async () => {
    const { worker, manager } = await setupCompany();
    await createActivity(worker, {
      title: "Pending approval in queue",
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: NOW,
    });

    const list = await listProfileActivities(testDb, viewer(manager.id), worker.id);

    expect(list.map((k) => k.title)).toEqual(["Pending approval in queue"]);
  });

  it("never exposes rejected activities to higher management", async () => {
    const { worker, manager, generalManager } = await setupCompany();
    const reason = await createApprovalReason("REJECTED");
    await createActivity(worker, {
      title: "Rejected activity",
      approvalStatus: "REJECTED",
      approverId: manager.id,
      approvalReasonId: reason.id,
      approvalReasonKind: "REJECTED",
    });

    const list = await listProfileActivities(testDb, viewer(generalManager.id), worker.id);

    expect(list).toEqual([]);
  });

  it("sorts activities in reverse chronological order", async () => {
    const { worker, manager } = await setupCompany();
    await createActivity(worker, {
      title: "Older",
      activityDate: new Date("2026-08-10T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });
    await createActivity(worker, {
      title: "Newer",
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
    });

    const list = await listProfileActivities(testDb, viewer(worker.id), worker.id);

    expect(list.map((k) => k.title)).toEqual(["Newer", "Older"]);
    expect(list[0]?.activityNo).toBeGreaterThan(0);
  });

  it("returns empty list when user is not authorized to view profile", async () => {
    const { worker, outsider, manager } = await setupCompany();
    await createActivity(worker, { approvalStatus: "APPROVED", approverId: manager.id });

    const list = await listProfileActivities(testDb, viewer(outsider.id), worker.id);

    expect(list).toEqual([]);
  });
});
