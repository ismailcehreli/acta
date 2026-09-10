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
  type: "Departman",
  sortOrder: 0,
  requiresApproval: false,
  autoFlowsUp: true,
  attentionGroupId: null,
};

describe("birim ekleme", () => {
  it("kök birim oluşturulur", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Şirket",
      type: "Kök",
      parentId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parentId).toBeNull();
  });

  it("ikinci kök birim reddedilir ve anlaşılır hata döner", async () => {
    await createUnit(testDb, { ...baseInput, name: "Şirket", parentId: null });

    const result = await createUnit(testDb, {
      ...baseInput,
      name: "İkinci Şirket",
      parentId: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_root");
    expect(result.message).toMatch(/yalnızca bir kök/i);
  });

  it("pasif birimin altına yeni birim eklenemez", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Alt birim",
      parentId: passive.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_parent");
  });

  it("olmayan üst birim reddedilir", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Alt birim",
      parentId: "00000000-0000-0000-0000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("parent_not_found");
  });

  it("davranış bayrakları kaydedilir (§4.3)", async () => {
    const result = await createUnit(testDb, {
      ...baseInput,
      name: "Kalıphane",
      parentId: null,
      requiresApproval: true,
      autoFlowsUp: false,
      attentionGroupId: "yonetim-kurulu",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requiresApproval).toBe(true);
    expect(result.value.autoFlowsUp).toBe(false);
    expect(result.value.attentionGroupId).toBe("yonetim-kurulu");
  });
});

describe("birim düzenleme (§4.3)", () => {
  const duzenle = {
    name: "Kalıphane",
    type: "Departman",
    requiresApproval: false,
    autoFlowsUp: true,
    attentionGroupId: null,
  };

  it("ad, kademe, dikkat grubu ve bayraklar değişir", async () => {
    const unit = await createOrgUnit({
      name: "Yanlış Ad",
      type: "Ekip",
      requiresApproval: false,
      autoFlowsUp: true,
      attentionGroupId: null,
    });

    const result = await updateOrgUnit(testDb, {
      id: unit.id,
      name: "Kalıphane",
      type: "Departman",
      requiresApproval: true,
      autoFlowsUp: false,
      attentionGroupId: "yonetim-kurulu",
    });

    expect(result.ok).toBe(true);

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(stored.name).toBe("Kalıphane");
    expect(stored.type).toBe("Departman");
    expect(stored.requiresApproval).toBe(true);
    expect(stored.autoFlowsUp).toBe(false);
    expect(stored.attentionGroupId).toBe("yonetim-kurulu");
  });

  it("yeri ve aktifliği değiştirmez", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    await updateOrgUnit(testDb, { ...duzenle, id: unit.id });

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    // Taşıma ve pasifleştirme ayrı işlemler; düzenleme onların kontrollerini
    // atlamanın yolu olmamalı.
    expect(stored.parentId).toBe(root.id);
    expect(stored.isActive).toBe(true);
  });

  it("olmayan birim reddedilir", async () => {
    const result = await updateOrgUnit(testDb, {
      ...duzenle,
      id: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  it("pasif birim düzenlenemez", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await updateOrgUnit(testDb, { ...duzenle, id: unit.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_unit");
  });

  it("bayrak değişikliği geçmiş faaliyetleri etkilemez", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id, requiresApproval: false });
    const user = await createUser(unit.id, { fullName: "Kalıphane Müdürü" });

    const activity = await testDb.activity.create({
      data: {
        authorId: user.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "Kalıp bakımı",
        description: "Haftalık bakım yapıldı.",
        approvalStatus: "APPROVED",
      },
    });

    await updateOrgUnit(testDb, {
      ...duzenle,
      id: unit.id,
      requiresApproval: true,
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    // Yeni kural yalnız bundan sonrasına uygulanır; geçmiş kayıt olduğu gibi
    // kalır (açık soru 14, 19.08.2026).
    expect(stored.approvalStatus).toBe("APPROVED");
  });
});

describe("birim aktifleştirme", () => {
  it("pasifleştirilen birim geri açılır", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    await deactivateOrgUnit(testDb, unit.id);
    const sonuc = await reactivateOrgUnit(testDb, unit.id);

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(stored.isActive).toBe(true);
  });

  it("üstü pasif olan birim açılamaz", async () => {
    const root = await createOrgUnit();
    const ara = await createOrgUnit({ parentId: root.id });
    const alt = await createOrgUnit({ parentId: ara.id });

    // Önce alttan başlayarak kapatılır; üst kapalıyken alt açılamamalı.
    await deactivateOrgUnit(testDb, alt.id);
    await deactivateOrgUnit(testDb, ara.id);

    const sonuc = await reactivateOrgUnit(testDb, alt.id);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("inactive_parent");

    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: alt.id } });
    expect(stored.isActive).toBe(false);
  });

  it("alt birimler kendiliğinden açılmaz", async () => {
    const root = await createOrgUnit();
    const ara = await createOrgUnit({ parentId: root.id });
    const alt = await createOrgUnit({ parentId: ara.id });

    await deactivateOrgUnit(testDb, alt.id);
    await deactivateOrgUnit(testDb, ara.id);
    await reactivateOrgUnit(testDb, ara.id);

    // Üst açıldı; alt bilerek kapalı kalır. Toptan açmak, kapatılırken
    // bilinçli olarak pasifleştirilmiş dalları da canlandırırdı.
    const stored = await testDb.orgUnit.findUniqueOrThrow({ where: { id: alt.id } });
    expect(stored.isActive).toBe(false);
  });

  it("zaten aktif birim reddedilir", async () => {
    const root = await createOrgUnit();

    const sonuc = await reactivateOrgUnit(testDb, root.id);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("already_active");
  });

  it("olmayan birim reddedilir", async () => {
    const sonuc = await reactivateOrgUnit(
      testDb,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_found");
  });
});

describe("birim taşıma", () => {
  it("birim başka bir üstün altına taşınır", async () => {
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

  it("kendi altına taşıma anlaşılır hata verir", async () => {
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
    expect(result.message).toMatch(/kendi altındaki/i);
  });

  it("derinlik sınırını aşan taşıma reddedilir", async () => {
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

  it("pasif birimin altına taşınamaz", async () => {
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

describe("birim pasifleştirme (§4.6)", () => {
  it("boş birim pasifleştirilir, silinmez", async () => {
    const root = await createOrgUnit();
    const unit = await createOrgUnit({ parentId: root.id });

    const result = await deactivateOrgUnit(testDb, unit.id);

    expect(result.ok).toBe(true);
    // Kayıt duruyor, yalnızca bayrağı düştü.
    const stored = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: unit.id },
    });
    expect(stored.isActive).toBe(false);
  });

  it("aktif kullanıcısı olan birim pasifleştirilemez", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    const result = await deactivateOrgUnit(testDb, unit.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("has_active_users");
  });

  it("aktif alt birimi olan birim pasifleştirilemez", async () => {
    const root = await createOrgUnit();
    const parent = await createOrgUnit({ parentId: root.id });
    await createOrgUnit({ parentId: parent.id });

    const result = await deactivateOrgUnit(testDb, parent.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("has_active_children");
  });
});

describe("ağaç okuma", () => {
  it("ağaç kökten başlayarak iç içe döner ve kullanıcı sayısını taşır", async () => {
    const root = await createOrgUnit({ name: "Şirket" });
    const child = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
    await createUser(child.id);
    await createUser(child.id);

    const tree = await loadOrgTree(testDb);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Şirket");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].activeUserCount).toBe(2);
  });
});

// §15.1: sistem yöneticisi rolü işlevsel yetkidir. Yönetim ekranlarına
// erişimin kuralı tek bir yerde durur ve sunucu eylemlerinin ilk satırında
// çalışır.
describe("yönetim yetkisi", () => {
  it("sistem yöneticisi organizasyonu yönetebilir", () => {
    expect(canManageOrganization({ isSystemAdmin: true })).toBe(true);
  });

  it("sıradan kullanıcı yönetemez", () => {
    expect(canManageOrganization({ isSystemAdmin: false })).toBe(false);
  });

  it("oturumsuz istek yönetemez", () => {
    expect(canManageOrganization(null)).toBe(false);
  });
});
