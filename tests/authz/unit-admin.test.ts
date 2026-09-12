import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canManageUser,
  manageableUnitIds,
} from "@/server/authz/unit-admin";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Unit Manager Administrative Permissions
//
// Authority is strictly bounded to the manager's subtree and preserves the §15.1
// distinction: functional management permissions do not expand content visibility.
//
// Managers cannot manage entities outside their subtree or escalate permissions.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const production = await createOrgUnit({ name: "Production", parentId: root.id });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: production.id });
  const paintShop = await createOrgUnit({ name: "Paint Shop", parentId: production.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const gm = await createUser(root.id, { fullName: "General Manager", isUnitManager: true });
  const productionManager = await createUser(production.id, {
    fullName: "Production Manager",
    isUnitManager: true,
  });
  const workshopManager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const craftsman = await createUser(workshop.id, { fullName: "Senior Craftsman" });
  const painter = await createUser(paintShop.id, { fullName: "Painter" });
  const planner = await createUser(planning.id, { fullName: "Planner" });
  const admin = await createUser(root.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  return {
    units: { root, production, workshop, paintShop, planning },
    gm,
    productionManager,
    workshopManager,
    craftsman,
    painter,
    planner,
    admin,
  };
}

describe("manageable units", () => {
  it("manager manages their own unit and all descendant units", async () => {
    const { units, productionManager } = await setupCompany();

    const unitIds = await manageableUnitIds(testDb, productionManager.id);

    expect(new Set(unitIds)).toEqual(
      new Set([units.production.id, units.workshop.id, units.paintShop.id]),
    );
  });

  it("sibling unit is not in manageable list", async () => {
    const { units, productionManager } = await setupCompany();

    const unitIds = await manageableUnitIds(testDb, productionManager.id);

    expect(unitIds).not.toContain(units.planning.id);
  });

  it("parent unit is not in manageable list", async () => {
    const { units, workshopManager } = await setupCompany();

    const unitIds = await manageableUnitIds(testDb, workshopManager.id);

    expect(unitIds).toEqual([units.workshop.id]);
  });

  it("non-manager user has empty manageable units list", async () => {
    const { craftsman } = await setupCompany();

    expect(await manageableUnitIds(testDb, craftsman.id)).toEqual([]);
  });

  it("system admin manages all active units", async () => {
    const { units, admin } = await setupCompany();

    const unitIds = await manageableUnitIds(testDb, admin.id);

    expect(new Set(unitIds)).toEqual(new Set(Object.values(units).map((u) => u.id)));
  });
});

describe("user management permission", () => {
  it("manager can manage an employee in their subtree", async () => {
    const { productionManager, craftsman } = await setupCompany();

    expect(await canManageUser(testDb, productionManager.id, craftsman.id)).toBe(true);
  });

  it("manager cannot manage a user in a sibling tree", async () => {
    const { productionManager, planner } = await setupCompany();

    expect(await canManageUser(testDb, productionManager.id, planner.id)).toBe(false);
  });

  it("manager cannot manage a user above them in the tree", async () => {
    const { workshopManager, gm } = await setupCompany();

    expect(await canManageUser(testDb, workshopManager.id, gm.id)).toBe(false);
  });

  it("manager cannot manage their own account via administrative endpoint", async () => {
    const { productionManager } = await setupCompany();

    expect(await canManageUser(testDb, productionManager.id, productionManager.id)).toBe(false);
  });

  it("non-manager cannot manage any user", async () => {
    const { craftsman, painter } = await setupCompany();

    expect(await canManageUser(testDb, craftsman.id, painter.id)).toBe(false);
  });

  it("system admin can manage any user", async () => {
    const { admin, planner } = await setupCompany();

    expect(await canManageUser(testDb, admin.id, planner.id)).toBe(true);
  });

  it("root account is protected even from other system admins", async () => {
    const { units, admin } = await setupCompany();
    const rootUser = await createUser(units.root.id, {
      fullName: "Root Account",
      email: "root@example.test",
      isSystemAdmin: true,
      isRoot: true,
    });

    expect(await canManageUser(testDb, admin.id, rootUser.id)).toBe(false);
    expect(await canManageUser(testDb, rootUser.id, admin.id)).toBe(true);
  });

  it("manager cannot manage a system admin located in their subtree", async () => {
    const { units, productionManager } = await setupCompany();
    const subordinateAdmin = await createUser(units.workshop.id, {
      fullName: "Subordinate Admin",
      isSystemAdmin: true,
    });

    expect(await canManageUser(testDb, productionManager.id, subordinateAdmin.id)).toBe(false);
  });
});
