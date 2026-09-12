import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isInManagementChain, managementChain } from "@/server/org/chain";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";




beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function threeLevels() {
  const root = await createOrgUnit({ name: "General Management", type: "Root" });
  const directorate = await createOrgUnit({
    name: "Directorate",
    parentId: root.id,
  });
  const department = await createOrgUnit({
    name: "Mold Shop",
    parentId: directorate.id,
  });
  const peerDepartment = await createOrgUnit({
    name: "Planlama",
    parentId: directorate.id,
  });

  return {
    generalManager: await createUser(root.id, { isUnitManager: true }),
    director: await createUser(directorate.id, { isUnitManager: true }),
    manager: await createUser(department.id, { isUnitManager: true }),
    worker: await createUser(department.id),
    peer: await createUser(peerDepartment.id, { isUnitManager: true }),
  };
}

describe("management chain", () => {
  it("the direct manager is in the chain", async () => {
    const { worker, manager } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, manager.id)).toBe(true);
  });

  it("a manager two levels up is also in the chain", async () => {
    const { worker, generalManager } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, generalManager.id)).toBe(
      true,
    );
  });

  it("a peer is not in the chain", async () => {
    const { worker, peer } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, peer.id)).toBe(false);
  });

  it("a subordinate is not in their manager's chain", async () => {
    const { worker, manager } = await threeLevels();

    expect(await isInManagementChain(testDb, manager.id, worker.id)).toBe(false);
  });

  it("a person is not in their own chain", async () => {
    const { worker } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, worker.id)).toBe(false);
  });

  it("the chain is ordered from the nearest manager to the root", async () => {
    const { worker, manager, director, generalManager } = await threeLevels();

    expect(await managementChain(testDb, worker.id)).toEqual([
      manager.id,
      director.id,
      generalManager.id,
    ]);
  });

  it("the root manager has no manager above them", async () => {
    const { generalManager } = await threeLevels();

    expect(await managementChain(testDb, generalManager.id)).toEqual([]);
  });

  it("a deactivated manager is not counted in the chain", async () => {
    const { worker, manager, director } = await threeLevels();
    await testDb.user.update({
      where: { id: manager.id },
      data: { isActive: false, isUnitManager: false },
    });

    expect(await isInManagementChain(testDb, worker.id, manager.id)).toBe(false);
    expect(await isInManagementChain(testDb, worker.id, director.id)).toBe(true);
  });
});
