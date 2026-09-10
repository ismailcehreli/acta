import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isInManagementChain, managementChain } from "@/server/org/chain";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Üst zincir, §4.4'teki yönetici türetmesinin tekrarlanmasıdır. İptal yetkisi
// (§5.5) ve ileride görünürlük (§8.1) buna dayanır.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function threeLevels() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const directorate = await createOrgUnit({
    name: "Direktörlük",
    parentId: root.id,
  });
  const department = await createOrgUnit({
    name: "Kalıphane",
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

describe("üst zincir", () => {
  it("doğrudan yönetici zincirdedir", async () => {
    const { worker, manager } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, manager.id)).toBe(true);
  });

  it("iki kademe yukarısı da zincirdedir", async () => {
    const { worker, generalManager } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, generalManager.id)).toBe(
      true,
    );
  });

  it("akran zincirde değildir", async () => {
    const { worker, peer } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, peer.id)).toBe(false);
  });

  it("ast, üstünün zincirinde değildir", async () => {
    const { worker, manager } = await threeLevels();

    expect(await isInManagementChain(testDb, manager.id, worker.id)).toBe(false);
  });

  it("kişinin kendisi kendi zincirinde sayılmaz", async () => {
    const { worker } = await threeLevels();

    expect(await isInManagementChain(testDb, worker.id, worker.id)).toBe(false);
  });

  it("zincir en yakın yöneticiden köke doğru sıralanır", async () => {
    const { worker, manager, director, generalManager } = await threeLevels();

    expect(await managementChain(testDb, worker.id)).toEqual([
      manager.id,
      director.id,
      generalManager.id,
    ]);
  });

  it("kökteki yöneticinin üstü yoktur", async () => {
    const { generalManager } = await threeLevels();

    expect(await managementChain(testDb, generalManager.id)).toEqual([]);
  });

  it("pasifleştirilmiş yönetici zincirde sayılmaz", async () => {
    const { worker, manager, director } = await threeLevels();
    await testDb.user.update({
      where: { id: manager.id },
      data: { isActive: false, isUnitManager: false },
    });

    expect(await isInManagementChain(testDb, worker.id, manager.id)).toBe(false);
    expect(await isInManagementChain(testDb, worker.id, director.id)).toBe(true);
  });
});
