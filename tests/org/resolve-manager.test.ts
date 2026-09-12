import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resolveManager } from "@/server/org/resolve-manager";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Each branch of the four rules in §4.4 is tested separately. This function determines
// who receives the activity, who receives the reminder, and in Version 2 who receives
// the approval; returning the wrong answer silently produces wrong behavior.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Helper setting up a root -> middle -> leaf chain. */
async function threeLevelTree() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const middle = await createOrgUnit({
    name: "Production Directorate",
    type: "Directorate",
    parentId: root.id,
  });
  const leaf = await createOrgUnit({
    name: "Molding",
    type: "Department",
    parentId: middle.id,
  });

  return { root, middle, leaf };
}

describe("rule 1 — non-manager individual", () => {
  it("resolves to the manager of own unit", async () => {
    const { leaf } = await threeLevelTree();
    const manager = await createUser(leaf.id, { isUnitManager: true });
    const worker = await createUser(leaf.id);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({
      found: true,
      managerId: manager.id,
      managerOrgUnitId: leaf.id,
    });
  });

  it("walks up to parent unit if no manager in own unit", async () => {
    const { middle, leaf } = await threeLevelTree();
    const director = await createUser(middle.id, { isUnitManager: true });
    const worker = await createUser(leaf.id);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({
      found: true,
      managerId: director.id,
      managerOrgUnitId: middle.id,
    });
  });
});

describe("rule 2 — unit manager individual", () => {
  it("resolves to manager of parent unit, not self", async () => {
    const { middle, leaf } = await threeLevelTree();
    const director = await createUser(middle.id, { isUnitManager: true });
    const departmentManager = await createUser(leaf.id, { isUnitManager: true });

    const result = await resolveManager(testDb, departmentManager.id);

    expect(result).toEqual({
      found: true,
      managerId: director.id,
      managerOrgUnitId: middle.id,
    });
  });
});

describe("rule 3 — ascending until manager found", () => {
  it("skips intermediate units without manager and continues up", async () => {
    const { root, leaf } = await threeLevelTree();
    // No manager in middle level; manager exists at root.
    const generalManager = await createUser(root.id, { isUnitManager: true });
    const departmentManager = await createUser(leaf.id, { isUnitManager: true });

    const result = await resolveManager(testDb, departmentManager.id);

    expect(result).toEqual({
      found: true,
      managerId: generalManager.id,
      managerOrgUnitId: root.id,
    });
  });

  it("deactivated manager is not considered, search continues upwards", async () => {
    const { root, middle, leaf } = await threeLevelTree();
    const generalManager = await createUser(root.id, { isUnitManager: true });
    const passiveDirector = await createUser(middle.id, {
      isUnitManager: true,
    });
    await testDb.user.update({
      where: { id: passiveDirector.id },
      data: { isActive: false },
    });
    const worker = await createUser(leaf.id);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({
      found: true,
      managerId: generalManager.id,
      managerOrgUnitId: root.id,
    });
  });
});

describe("rule 4 — no manager condition", () => {
  it("returns error if no manager in entire chain, does not fail silently", async () => {
    const { leaf } = await threeLevelTree();
    const worker = await createUser(leaf.id);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({ found: false, reason: "no_manager_in_chain" });
  });

  it("root manager has no manager above", async () => {
    const { root } = await threeLevelTree();
    const chairman = await createUser(root.id, { isUnitManager: true });

    const result = await resolveManager(testDb, chairman.id);

    expect(result).toEqual({ found: false, reason: "no_manager_in_chain" });
  });

  it("returns error for unknown user", async () => {
    const result = await resolveManager(
      testDb,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result).toEqual({ found: false, reason: "user_not_found" });
  });
});

describe("independence from hierarchy level count", () => {
  it("rule works identically when intermediate levels are added (Principle 1)", async () => {
    // Level names and counts come from data; no level names are hardcoded in code.
    let parentId: string | null = null;
    const unitIds: string[] = [];

    for (const name of ["Board", "GM", "Directorate", "Department", "Team"]) {
      const unit: { id: string } = await createOrgUnit(
        parentId ? { name, type: name, parentId } : { name, type: name },
      );
      unitIds.push(unit.id);
      parentId = unit.id;
    }

    const chairman = await createUser(unitIds[0], { isUnitManager: true });
    const worker = await createUser(unitIds[4]);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({
      found: true,
      managerId: chairman.id,
      managerOrgUnitId: unitIds[0],
    });
  });
});
