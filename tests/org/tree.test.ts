import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { canManageOrganization } from "@/server/authz/admin";
import {
  createOrgUnit as createUnit,
  deactivateOrgUnit,
  loadOrgTree,
  moveOrgUnit,
  reactivateOrgUnit,
  updateOrgUnit,
} from "@/server/org/tree";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const baseInput = {
  type: "Department",
  sortOrder: 0,
  requiresApproval: false,
  autoFlowsUp: true,
  attentionGroupId: null,
};

describe("adding org unit", () => {
  it("creates root unit", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Company",
      type: "Root",
      parentId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parentId).toBeNull();
  });

  it("rejects second root unit and returns clear error", async () => {
    await createUnit(testDb, { ...baseInput, name: "Company", parentId: null });

    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Second Company",
      parentId: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_root");
    expect(result.message).toMatch(/one root/i);
  });

  it("cannot add new unit under an inactive unit", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Sub-unit",
      parentId: passive.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_parent");
  });

  it("rejects non-existent parent unit", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Sub-unit",
      parentId: "00000000-0000-0000-0000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("parent_not_found");
  });

  it("saves behavioral flags (§4.3)", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Molding",
      parentId: null,
      requiresApproval: true,
      autoFlowsUp: false,
      attentionGroupId: "board-of-directors",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requiresApproval).toBe(true);
    expect(result.value.autoFlowsUp).toBe(false);
    expect(result.value.attentionGroupId).toBe("board-of-directors");
  });
});

describe("editing org unit (§4.3)", () => {
  const editInput = {
    name: "Molding",
    type: "Department",
    requiresApproval: false,
    autoFlowsUp: true,
    attentionGroupId: null,
  };

  it("changes name, level, attention group, and flags", async () => {
    const unit = await createOrgUnit({
      name: "Wrong Name",
      type: "Team",
      requiresApproval: false,
      autoFlowsUp: true,
      attentionGroupId: null,
    });

    const result = await updateOrgUnit(testDb, {
      id: unit.id,
      name: "Molding",
      type: "Department",
      requiresApproval: true,
      autoFlowsUp: false,
      attentionGroupId: "board-of-directors",
    });

    expect(result.ok).toBe(true);

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(stored.name).toBe("Molding");
    expect(stored.type).toBe("Department");
    expect(stored.requiresApproval).toBe(true);
    expect(stored.autoFlowsUp).toBe(false);
    expect(stored.attentionGroupId).toBe("board-of-directors");
  });

  it("does not change parent or active status", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    await updateOrgUnit(testDb, { ...editInput, id: unit.id });

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    // Moving and deactivating are separate actions; editing must not bypass their controls.
    expect(stored.parentId).toBe(root.id);
    expect(stored.isActive).toBe(true);
  });

  it("rejects non-existent unit", async () => {
    const result = await updateOrgUnit(testDb, {
      ...editInput,
      id: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  it("cannot edit inactive unit", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await updateOrgUnit(testDb, { ...editInput, id: unit.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_unit");
  });

  it("flag changes do not affect historical activities", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id, requiresApproval: false });
    const user = await createUser(unit.id, { fullName: "Molding Manager" });

    const activity = await testDb.activity.create({
      data: {
        authorId: user.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Mold maintenance",
        description: "Weekly maintenance performed.",
        approvalStatus: "APPROVED",
      },
    });

    await updateOrgUnit(testDb, {
      ...editInput,
      id: unit.id,
      requiresApproval: true,
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    // New rule only applies going forward; past records remain as they were.
    expect(stored.approvalStatus).toBe("APPROVED");
  });
});

describe("unit reactivation", () => {
  it("reopens deactivated unit", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    await deactivateOrgUnit(testDb, unit.id);
    const result = await reactivateOrgUnit(testDb, unit.id);

    expect(result.ok).toBe(true);
    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(stored.isActive).toBe(true);
  });

  it("cannot activate unit whose parent is inactive", async () => {
    const root = await createOrgUnit();
    const middle = await createOrgUnit({ parentId: root.id });
    const leaf = await createOrgUnit({ parentId: middle.id });

    await deactivateOrgUnit(testDb, leaf.id);
    await deactivateOrgUnit(testDb, middle.id);

    const result = await reactivateOrgUnit(testDb, leaf.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_parent");

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: leaf.id } });
    expect(stored.isActive).toBe(false);
  });

  it("does not automatically activate child units", async () => {
    const root = await createOrgUnit();
    const middle = await createOrgUnit({ parentId: root.id });
    const leaf = await createOrgUnit({ parentId: middle.id });

    await deactivateOrgUnit(testDb, leaf.id);
    await deactivateOrgUnit(testDb, middle.id);
    await reactivateOrgUnit(testDb, middle.id);

    // Parent activated; child deliberately remains inactive.
    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: leaf.id } });
    expect(stored.isActive).toBe(false);
  });

  it("rejects already active unit", async () => {
    const root = await createOrgUnit();

    const result = await reactivateOrgUnit(testDb, root.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_active");
  });

  it("rejects non-existent unit", async () => {
    const result = await reactivateOrgUnit(
      testDb,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});

describe("moving org unit", () => {
  it("moves unit under another parent", async () => {
    const root = await createOrgUnit();
    const first = await createOrgUnit({ parentId: root.id });
    const second = await createOrgUnit({ parentId: root.id });

    const result = await moveOrgUnit(testDb, {
      id: second.id,
      newParentId: first.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parentId).toBe(first.id);
  });

  it("returns clear error when moving under self", async () => {
    const root = await createOrgUnit();
    const middle = await createOrgUnit({ parentId: root.id });
    const leaf = await createOrgUnit({ parentId: middle.id });

    const result = await moveOrgUnit(testDb, {
      id: middle.id,
      newParentId: leaf.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("cycle");
    expect(result.message).toMatch(/own descendants/i);
  });

  it("rejects move exceeding depth limit", async () => {
    let parentId: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const unit: { id: string } = await createOrgUnit(
        parentId ? { parentId } : {},
      );
      parentId = unit.id;
    }

    const root = await testDb.orgUnit.findFirstOrThrow({
      where: { parentId: null },
    });
    const branch = await createOrgUnit({ parentId: root.id });

    const result = await moveOrgUnit(testDb, {
      id: branch.id,
      newParentId: parentId as string,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("max_depth");
  });

  it("cannot move under inactive unit", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });
    const unit = await createOrgUnit({ parentId: root.id });

    const result = await moveOrgUnit(testDb, {
      id: unit.id,
      newParentId: passive.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_parent");
  });
});

describe("deactivating org unit (§4.6)", () => {
  it("deactivates empty unit without deleting", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    const result = await deactivateOrgUnit(testDb, unit.id);

    expect(result.ok).toBe(true);
    // Row remains, flag is set to false.
    const stored = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: unit.id },
    });
    expect(stored.isActive).toBe(false);
  });

  it("cannot deactivate unit with active users", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    const result = await deactivateOrgUnit(testDb, unit.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("has_active_users");
  });

  it("cannot deactivate unit with active child units", async () => {
    const root = await createOrgUnit();
    const parent = await createOrgUnit({ parentId: root.id });
    await createOrgUnit({ parentId: parent.id });

    const result = await deactivateOrgUnit(testDb, parent.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("has_active_children");
  });
});

describe("loading tree", () => {
  it("returns nested hierarchy starting from root and includes user counts", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const child = await createOrgUnit({ name: "Molding", parentId: root.id });
    await createUser(child.id);
    await createUser(child.id);

    const tree = await loadOrgTree(testDb);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Company");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].activeUserCount).toBe(2);
  });
});

// §15.1: System admin role is functional authorization.
describe("admin authorization", () => {
  it("system admin can manage organization", () => {
    expect(canManageOrganization({ isSystemAdmin: true })).toBe(true);
  });

  it("ordinary user cannot manage organization", () => {
    expect(canManageOrganization({ isSystemAdmin: false })).toBe(false);
  });

  it("unauthenticated request cannot manage organization", () => {
    expect(canManageOrganization(null)).toBe(false);
  });
});
