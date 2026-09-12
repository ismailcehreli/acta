import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// §4.2: These rules are enforced in both the application and the database.
// The tests below verify the database layer - even if application code is bypassed,
// the tree cannot be corrupted.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Builds a chain at the specified depth and returns the bottom-most unit. */
async function createChain(depth: number): Promise<string> {
  let parentId: string | null = null;

  for (let level = 0; level < depth; level += 1) {
    const unit: { id: string } = await createOrgUnit(
      parentId ? { parentId } : {},
    );
    parentId = unit.id;
  }

  return parentId as string;
}

describe("single root constraint", () => {
  it("cannot add a second root unit", async () => {
    await createOrgUnit();

    await expect(createOrgUnit()).rejects.toThrow(/Unique constraint/i);
  });

  it("existing unit cannot be made a second root by promoting to root", async () => {
    const root = await createOrgUnit();
    const child = await createOrgUnit({ parentId: root.id });

    await expect(
      testDb.orgUnit.update({
        where: { id: child.id },
        data: { parentId: null },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});

// The value of constraints lies in their validity even when the application layer is bypassed:
// raw SQL, bulk imports, or future scripts hit the same wall.
describe("constraints cannot be bypassed with raw SQL", () => {
  it("cannot add second root via direct INSERT", async () => {
    await createOrgUnit();

    await expect(
      testDb.$executeRawUnsafe(`
        INSERT INTO "OrgUnit" ("id", "name", "type", "updatedAt")
        VALUES ('second-root', 'Second Root', 'Department', NOW())
      `),
      // 23505 = unique_violation; partial unique index rejects second root.
    ).rejects.toThrow(/23505/);
  });

  it("cannot create cycle via direct UPDATE", async () => {
    const root = await createOrgUnit();
    const child = await createOrgUnit({ parentId: root.id });

    await expect(
      testDb.$executeRawUnsafe(`
        UPDATE "OrgUnit" SET "parentId" = '${child.id}' WHERE "id" = '${root.id}'
      `),
    ).rejects.toThrow(/ORG_TREE_CYCLE/);
  });
});

describe("cycle constraint", () => {
  it("unit cannot be set as its own parent", async () => {
    const root = await createOrgUnit();

    await expect(
      testDb.orgUnit.update({
        where: { id: root.id },
        data: { parentId: root.id },
      }),
    ).rejects.toThrow(/ORG_TREE_CYCLE/);
  });

  it("parent unit cannot be moved under its own descendant", async () => {
    const root = await createOrgUnit();
    const middle = await createOrgUnit({ parentId: root.id });
    const leaf = await createOrgUnit({ parentId: middle.id });

    await expect(
      testDb.orgUnit.update({
        where: { id: middle.id },
        data: { parentId: leaf.id },
      }),
    ).rejects.toThrow(/ORG_TREE_CYCLE/);
  });
});

describe("maximum depth constraint", () => {
  it("can create 10 levels", async () => {
    const deepest = await createChain(10);

    const stored = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: deepest },
    });
    expect(stored.parentId).not.toBeNull();
  });

  it("cannot add 11th level", async () => {
    const deepest = await createChain(10);

    await expect(createOrgUnit({ parentId: deepest })).rejects.toThrow(
      /ORG_TREE_MAX_DEPTH/,
    );
  });

  it("move operation cannot push subtree beyond 10 levels", async () => {
    // 8-level main chain; plus a 3-level branch under root.
    const deepMain = await createChain(8);
    const root = await testDb.orgUnit.findFirstOrThrow({
      where: { parentId: null },
    });
    const branchTop = await createOrgUnit({ parentId: root.id });
    const branchMid = await createOrgUnit({ parentId: branchTop.id });
    await createOrgUnit({ parentId: branchMid.id });

    // Moving 3-level branch under 8th level pushes total to 11.
    await expect(
      testDb.orgUnit.update({
        where: { id: branchTop.id },
        data: { parentId: deepMain },
      }),
    ).rejects.toThrow(/ORG_TREE_MAX_DEPTH/);
  });
});

describe("unit manager constraint", () => {
  // 2026-08-20 decision: multiple managers can exist in a unit.
  // Constraint removed; only search index remains. The rule: activity lands in
  // approval queues of both managers, first one to decide settles it.
  it("can mark a second manager in the same unit", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { isUnitManager: true });

    await expect(
      createUser(unit.id, { isUnitManager: true }),
    ).resolves.toMatchObject({ isUnitManager: true });

    expect(
      await testDb.user.count({
        where: { orgUnitId: unit.id, isUnitManager: true },
      }),
    ).toBe(2);
  });

  it("different units can have their own managers", async () => {
    const root = await createOrgUnit();
    const child = await createOrgUnit({ parentId: root.id });

    await createUser(root.id, { isUnitManager: true });
    const secondManager = await createUser(child.id, { isUnitManager: true });

    expect(secondManager.isUnitManager).toBe(true);
  });
});

describe("active user - inactive org unit constraint", () => {
  it("cannot add active user to inactive org unit", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    await expect(createUser(passive.id)).rejects.toThrow(
      /USER_INACTIVE_ORG_UNIT/,
    );
  });

  it("cannot move user to inactive org unit", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });
    const user = await createUser(root.id);

    await expect(
      testDb.user.update({
        where: { id: user.id },
        data: { orgUnitId: passive.id },
      }),
    ).rejects.toThrow(/USER_INACTIVE_ORG_UNIT/);
  });

  it("cannot deactivate org unit that has active users", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    await expect(
      testDb.orgUnit.update({
        where: { id: unit.id },
        data: { isActive: false },
      }),
    ).rejects.toThrow(/ORG_UNIT_HAS_ACTIVE_USERS/);
  });

  it("can deactivate org unit once its users are deactivated", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });
    const user = await createUser(unit.id);

    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    const deactivated = await testDb.orgUnit.update({
      where: { id: unit.id },
      data: { isActive: false },
    });

    expect(deactivated.isActive).toBe(false);
  });
});
