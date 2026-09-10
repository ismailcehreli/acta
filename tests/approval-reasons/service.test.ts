import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createReason,
  listActiveReasons,
  listAllReasons,
  setReasonActive,
  updateReason,
} from "@/server/approval-reasons/service";
import { AUDIT_ACTIONS } from "@/server/audit/log";

import { createApprovalReason, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Onay kararı gerekçe kataloğu (ürün sahibi kararı, 19.08.2026).
//
// Serbest metin raporlanamaz; kategoriler sistem yöneticisinde. Silme yok,
// pasifleştirme var (§16.6) — geçmiş kararlar gerekçesini korur.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function admin() {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  return createUser(unit.id, { fullName: "Sistem Yöneticisi", isSystemAdmin: true });
}

describe("katalog yönetimi", () => {
  it("gerekçe eklenir ve denetim izine yazılır", async () => {
    const me = await admin();

    const sonuc = await createReason(
      testDb,
      { kind: "REJECTED", label: "Mükerrer kayıt", sortOrder: 20 },
      me.id,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.reason.label).toBe("Mükerrer kayıt");

    const iz = await testDb.auditLog.findFirst({
      where: {
        objectId: sonuc.reason.id,
        action: AUDIT_ACTIONS.approvalReasonCreated,
      },
    });
    expect(iz).not.toBeNull();
  });

  it("aynı türde aynı ad iki kez eklenemez", async () => {
    const me = await admin();
    await createReason(testDb, { kind: "REJECTED", label: "Mükerrer", sortOrder: 0 }, me.id);

    const sonuc = await createReason(
      testDb,
      { kind: "REJECTED", label: "Mükerrer", sortOrder: 0 },
      me.id,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("duplicate_label");
  });

  it("aynı ad farklı türde kullanılabilir", async () => {
    const me = await admin();
    await createReason(testDb, { kind: "REJECTED", label: "Diğer", sortOrder: 0 }, me.id);

    const sonuc = await createReason(
      testDb,
      { kind: "CHANGES_REQUESTED", label: "Diğer", sortOrder: 0 },
      me.id,
    );

    expect(sonuc.ok).toBe(true);
  });

  it("ad ve sıra düzeltilir; eski hâl denetim izinde kalır", async () => {
    const me = await admin();
    const gerekce = await createApprovalReason("REJECTED", "Yanlş yazım");

    const sonuc = await updateReason(
      testDb,
      { id: gerekce.id, label: "Yanlış yazım", sortOrder: 5 },
      me.id,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.reason.label).toBe("Yanlış yazım");

    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { objectId: gerekce.id, action: AUDIT_ACTIONS.approvalReasonUpdated },
    });
    // Etiket değişince geçmiş kayıtların gerekçesi de değişir; ize eski hâl
    // yazılmasaydı bu değişiklik izlenemez olurdu.
    expect(JSON.stringify(iz.detail)).toContain("Yanlş yazım");
  });
});

describe("pasifleştirme", () => {
  it("pasif gerekçe karar ekranında görünmez ama katalogda durur", async () => {
    const me = await admin();
    const kalan = await createApprovalReason("REJECTED", "Kalan");
    const kalkan = await createApprovalReason("REJECTED", "Kalkan");

    await setReasonActive(testDb, kalkan.id, false, me.id);

    const aktifler = await listActiveReasons(testDb, "REJECTED");
    expect(aktifler.map((r) => r.id)).toEqual([kalan.id]);

    // Silinmedi (§16.6).
    expect((await listAllReasons(testDb)).length).toBe(2);
  });

  it("son aktif gerekçe pasifleştirilemez", async () => {
    const me = await admin();
    const tek = await createApprovalReason("REJECTED", "Tek gerekçe");

    const sonuc = await setReasonActive(testDb, tek.id, false, me.id);

    // Katalogu boşalan karar türü hiç verilemez hâle gelirdi: müdür
    // reddetmek isteyip seçecek gerekçe bulamazdı.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("last_active_reason");

    const guncel = await testDb.approvalReason.findUniqueOrThrow({
      where: { id: tek.id },
    });
    expect(guncel.isActive).toBe(true);
  });

  it("başka türde gerekçe kalması yetmez", async () => {
    const me = await admin();
    await createApprovalReason("CHANGES_REQUESTED", "Düzeltme gerekçesi");
    const tekRet = await createApprovalReason("REJECTED", "Tek ret gerekçesi");

    const sonuc = await setReasonActive(testDb, tekRet.id, false, me.id);

    expect(sonuc.ok).toBe(false);
  });

  it("pasifleştirilen gerekçe yeniden açılabilir", async () => {
    const me = await admin();
    await createApprovalReason("REJECTED", "Kalan");
    const kalkan = await createApprovalReason("REJECTED", "Kalkan");
    await setReasonActive(testDb, kalkan.id, false, me.id);

    const sonuc = await setReasonActive(testDb, kalkan.id, true, me.id);

    expect(sonuc.ok).toBe(true);
    expect((await listActiveReasons(testDb, "REJECTED")).length).toBe(2);
  });

  it("sıra numarasına göre sıralanır", async () => {
    await testDb.approvalReason.createMany({
      data: [
        { kind: "REJECTED", label: "Sonra", sortOrder: 90 },
        { kind: "REJECTED", label: "Önce", sortOrder: 10 },
      ],
    });

    const liste = await listActiveReasons(testDb, "REJECTED");

    expect(liste.map((r) => r.label)).toEqual(["Önce", "Sonra"]);
  });
});

describe("kullanılan gerekçe silinemez", () => {
  it("faaliyete bağlı gerekçe veritabanınca korunur", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const yazan = await createUser(unit.id, { fullName: "Yazan" });
    const onaylayan = await createUser(unit.id, { fullName: "Onaylayan" });
    const gerekce = await createApprovalReason("REJECTED", "Kullanılan");

    await testDb.activity.create({
      data: {
        authorId: yazan.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        title: "Kayıt",
        description: "içerik",
        approvalStatus: "REJECTED",
        approverId: onaylayan.id,
        approvalReasonId: gerekce.id,
        approvalReasonKind: "REJECTED",
      },
    });

    // Fiziksel silme yok (§16.6); yabancı anahtar da engelliyor.
    await expect(
      testDb.approvalReason.delete({ where: { id: gerekce.id } }),
    ).rejects.toThrow();
  });
});
