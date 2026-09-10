import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// §4.2: bu kurallar hem uygulamada hem veritabanında zorunludur. Aşağıdaki
// testler veritabanı katmanını doğrular — uygulama kodu devre dışı bırakılsa
// bile ağaç bozulamaz.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Verilen derinlikte zincir kurar ve en alttaki birimi döndürür. */
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

describe("tek kök kısıtı", () => {
  it("ikinci bir kök birim eklenemez", async () => {
    await createOrgUnit();

    await expect(createOrgUnit()).rejects.toThrow(/Unique constraint/i);
  });

  it("var olan birim köke çıkarılarak ikinci kök yapılamaz", async () => {
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

// Kısıtların değeri, uygulama katmanı devrede olmadığında da geçerli
// olmalarındadır: elle çalıştırılan SQL, toplu aktarım veya ileride yazılacak
// bir betik de aynı duvara çarpar.
describe("kısıtlar ham SQL ile de atlanamaz", () => {
  it("doğrudan INSERT ile ikinci kök eklenemez", async () => {
    await createOrgUnit();

    await expect(
      testDb.$executeRawUnsafe(`
        INSERT INTO "OrgUnit" ("id", "name", "type", "updatedAt")
        VALUES ('ikinci-kok', 'İkinci Kök', 'Departman', NOW())
      `),
      // 23505 = unique_violation; kısmi tekil indeks ikinci kökü reddediyor.
    ).rejects.toThrow(/23505/);
  });

  it("doğrudan UPDATE ile döngü kurulamaz", async () => {
    const root = await createOrgUnit();
    const child = await createOrgUnit({ parentId: root.id });

    await expect(
      testDb.$executeRawUnsafe(`
        UPDATE "OrgUnit" SET "parentId" = '${child.id}' WHERE "id" = '${root.id}'
      `),
    ).rejects.toThrow(/ORG_TREE_CYCLE/);
  });
});

describe("döngü kısıtı", () => {
  it("birim kendi üstü yapılamaz", async () => {
    const root = await createOrgUnit();

    await expect(
      testDb.orgUnit.update({
        where: { id: root.id },
        data: { parentId: root.id },
      }),
    ).rejects.toThrow(/ORG_TREE_CYCLE/);
  });

  it("üst birim, kendi altındaki bir birimin altına taşınamaz", async () => {
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

describe("azami derinlik kısıtı", () => {
  it("10 kademe kurulabilir", async () => {
    const deepest = await createChain(10);

    const stored = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: deepest },
    });
    expect(stored.parentId).not.toBeNull();
  });

  it("11. kademe eklenemez", async () => {
    const deepest = await createChain(10);

    await expect(createOrgUnit({ parentId: deepest })).rejects.toThrow(
      /ORG_TREE_MAX_DEPTH/,
    );
  });

  it("taşıma, alt dalı 10 kademenin ötesine itemez", async () => {
    // 8 kademelik ana zincir; kökün altında ayrıca 3 kademelik küçük bir dal.
    const deepMain = await createChain(8);
    const root = await testDb.orgUnit.findFirstOrThrow({
      where: { parentId: null },
    });
    const branchTop = await createOrgUnit({ parentId: root.id });
    const branchMid = await createOrgUnit({ parentId: branchTop.id });
    await createOrgUnit({ parentId: branchMid.id });

    // 3 kademelik dalı 8. kademenin altına taşımak toplamı 11'e çıkarır.
    await expect(
      testDb.orgUnit.update({
        where: { id: branchTop.id },
        data: { parentId: deepMain },
      }),
    ).rejects.toThrow(/ORG_TREE_MAX_DEPTH/);
  });
});

describe("birim yöneticisi kısıtı", () => {
  // 20.08.2026 kararı: bir birimde birden fazla müdür olabilir. Kısıt
  // kaldırıldı; yerine yalnızca arama indeksi kaldı. Kural artık şu: kayıt
  // her iki müdürün de onay kuyruğuna düşer, ilk karar veren kapatır.
  it("bir birimde ikinci yönetici işaretlenebilir", async () => {
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

  it("farklı birimlerin kendi yöneticisi olabilir", async () => {
    const root = await createOrgUnit();
    const child = await createOrgUnit({ parentId: root.id });

    await createUser(root.id, { isUnitManager: true });
    const secondManager = await createUser(child.id, { isUnitManager: true });

    expect(secondManager.isUnitManager).toBe(true);
  });
});

describe("aktif kullanıcı – pasif birim kısıtı", () => {
  it("aktif kullanıcı pasif birime eklenemez", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    await expect(createUser(passive.id)).rejects.toThrow(
      /USER_INACTIVE_ORG_UNIT/,
    );
  });

  it("kullanıcı pasif birime taşınamaz", async () => {
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

  it("aktif kullanıcısı olan birim pasifleştirilemez", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    await expect(
      testDb.orgUnit.update({
        where: { id: unit.id },
        data: { isActive: false },
      }),
    ).rejects.toThrow(/ORG_UNIT_HAS_ACTIVE_USERS/);
  });

  it("kullanıcıları pasifleştirilmiş birim pasifleştirilebilir", async () => {
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
