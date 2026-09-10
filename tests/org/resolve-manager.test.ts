import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resolveManager } from "@/server/org/resolve-manager";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §4.4'ün dört kuralının her dalı ayrı ayrı sınanır. Bu fonksiyon faaliyetin
// kime düşeceğini, hatırlatmanın kime gideceğini ve Sürüm 2'de onayın kime
// gideceğini belirler; yanlış cevabı sessizce yanlış davranış üretir.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Kök → orta → alt zinciri kuran ortak düzen. */
async function threeLevelTree() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const middle = await createOrgUnit({
    name: "Üretim Direktörlüğü",
    type: "Direktörlük",
    parentId: root.id,
  });
  const leaf = await createOrgUnit({
    name: "Kalıphane",
    type: "Departman",
    parentId: middle.id,
  });

  return { root, middle, leaf };
}

describe("kural 1 — birim yöneticisi olmayan kişi", () => {
  it("kendi biriminin yöneticisine bağlanır", async () => {
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

  it("kendi biriminde yönetici yoksa üst birime çıkar", async () => {
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

describe("kural 2 — birim yöneticisi olan kişi", () => {
  it("üst birimin yöneticisine bağlanır, kendisine değil", async () => {
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

describe("kural 3 — yönetici bulunana kadar yukarı çıkma", () => {
  it("aradaki birimde yönetici yoksa bir üste devam eder", async () => {
    const { root, leaf } = await threeLevelTree();
    // Orta kademede yönetici yok; kökte var.
    const generalManager = await createUser(root.id, { isUnitManager: true });
    const departmentManager = await createUser(leaf.id, { isUnitManager: true });

    const result = await resolveManager(testDb, departmentManager.id);

    expect(result).toEqual({
      found: true,
      managerId: generalManager.id,
      managerOrgUnitId: root.id,
    });
  });

  it("pasifleştirilmiş yönetici aday sayılmaz, arama yukarı devam eder", async () => {
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

describe("kural 4 — yöneticisiz durum", () => {
  it("zincirde hiç yönetici yoksa hata döner, sessizce geçilmez", async () => {
    const { leaf } = await threeLevelTree();
    const worker = await createUser(leaf.id);

    const result = await resolveManager(testDb, worker.id);

    expect(result).toEqual({ found: false, reason: "no_manager_in_chain" });
  });

  it("kökün yöneticisinin üstü yoktur", async () => {
    const { root } = await threeLevelTree();
    const chairman = await createUser(root.id, { isUnitManager: true });

    const result = await resolveManager(testDb, chairman.id);

    expect(result).toEqual({ found: false, reason: "no_manager_in_chain" });
  });

  it("bilinmeyen kullanıcı için hata döner", async () => {
    const result = await resolveManager(
      testDb,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result).toEqual({ found: false, reason: "user_not_found" });
  });
});

describe("kademe sayısından bağımsızlık", () => {
  it("kural, araya kademe eklendiğinde de aynı çalışır (İlke 1)", async () => {
    // Kademe adları ve sayısı veriden gelir; kodda hiçbir kademe adı geçmez.
    let parentId: string | null = null;
    const unitIds: string[] = [];

    for (const name of ["YK", "GM", "Direktörlük", "Müdürlük", "Ekip"]) {
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
