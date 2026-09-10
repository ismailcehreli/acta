import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { departmentSummary } from "@/server/dashboard/department-summary";
import { subordinateUserIds } from "@/server/authz/visibility";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Departman bazında özet (ürün sahibi kararı, 19.08.2026).
//
// En kritik iddia sızıntıyla ilgili: özet, akışın **göremediği** bir kaydı
// sayıya katmamalı. Sayı da bir bilgidir (§18.4).

const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const direktorluk = await createOrgUnit({ name: "Direktörlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: direktorluk.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: direktorluk.id });
  // Direktörün kapsamı dışında kalan bir dal: sayıya girmemeli.
  const muhasebe = await createOrgUnit({ name: "Muhasebe", parentId: root.id });

  const direktor = await createUser(direktorluk.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const kalipci = await createUser(kaliphane.id, { fullName: "Kalıpçı" });
  const planci = await createUser(planlama.id, { fullName: "Plancı" });
  const muhasebeci = await createUser(muhasebe.id, { fullName: "Muhasebeci" });

  return {
    direktor,
    kalipci,
    planci,
    muhasebeci,
    kaliphane,
    planlama,
    muhasebe,
  };
}

async function faaliyetYaz(
  kisi: { id: string; orgUnitId: string },
  tarih: string,
  durum: "APPROVED" | "CANCELLED" | "PENDING_APPROVAL" = "APPROVED",
) {
  return testDb.activity.create({
    data: {
      authorId: kisi.id,
      authorOrgUnitId: kisi.orgUnitId,
      activityDate: new Date(`${tarih}T00:00:00.000Z`),
      title: `Kayıt ${tarih}`,
      description: "içerik",
      approvalStatus: durum,
      approverId:
        durum === "PENDING_APPROVAL" ? await onaylayiciIdsi(kisi.id) : null,
    },
  });
}

/**
 * Onay sürecindeki kayıt onaylayıcı ister (kısıt
 * `Activity_approver_required_in_approval`). §4.4'ün çözdüğü gerçek yönetici
 * kullanılır ki test verisi üretimde doğabilecek bir kayıt olsun.
 */
async function onaylayiciIdsi(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const sonuc = await resolveManager(testDb, userId);
  return sonuc.found ? sonuc.managerId : null;
}


async function ozet(
  viewerId: string,
  period: "today" | "week" | "all" = "week",
  includeRoot = false,
) {
  const subordinates = await subordinateUserIds(testDb, viewerId);
  return departmentSummary(
    testDb,
    { id: viewerId, isSystemAdmin: false },
    subordinates,
    period,
    NOW,
    { includeRoot },
  );
}

describe("departman özeti", () => {
  it("altındaki her departman için satır döner", async () => {
    const { direktor, kalipci, planci } = await sirket();
    await faaliyetYaz(kalipci, "2026-08-18");
    await faaliyetYaz(kalipci, "2026-08-17");
    await faaliyetYaz(planci, "2026-08-18");

    const satirlar = await ozet(direktor.id);

    expect(satirlar.map((s) => s.name)).toEqual(["Kalıphane", "Planlama"]);
    expect(satirlar[0]).toMatchObject({ people: 1, activityCount: 2 });
    expect(satirlar[1]).toMatchObject({ people: 1, activityCount: 1 });
  });

  it("aynı birimdeki yöneticinin kaydı yönetilen sayıya girmez", async () => {
    const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const unit = await createOrgUnit({ name: "Operasyon", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Operasyon Müdürü",
      isUnitManager: true,
    });
    const worker = await createUser(unit.id, { fullName: "Operasyon Çalışanı" });

    await faaliyetYaz(manager, "2026-08-18");
    await faaliyetYaz(worker, "2026-08-18");

    const satirlar = await ozet(manager.id, "week", true);
    const operasyon = satirlar.find((satir) => satir.name === "Operasyon");

    expect(operasyon).toMatchObject({
      people: 1,
      activityCount: 1,
      directPeople: 1,
      directActivityCount: 1,
    });
  });

  it("kapsam dışındaki departman hiç görünmez", async () => {
    const { direktor, muhasebeci } = await sirket();
    await faaliyetYaz(muhasebeci, "2026-08-18");

    const satirlar = await ozet(direktor.id);

    // Muhasebe direktörün altında değil: ne satırı ne sayısı görünmeli.
    expect(satirlar.map((s) => s.name)).not.toContain("Muhasebe");
    expect(satirlar.reduce((t, s) => t + s.activityCount, 0)).toBe(0);
  });

  it("yöneticinin göremediği kayıt sayıya girmez", async () => {
    const { direktor, kalipci, kaliphane } = await sirket();
    // Kalıphane'ye kendi müdürü atanır: onay bekleyen kayıt **ona** düşer,
    // direktöre değil. Direktör onu görmemeli (§8.2) ve sayıya girmemeli.
    await createUser(kaliphane.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    await faaliyetYaz(kalipci, "2026-08-18", "PENDING_APPROVAL");
    await faaliyetYaz(kalipci, "2026-08-18");

    const satirlar = await ozet(direktor.id);

    // İki kayıt var ama direktör birini göremiyor; sayı 1 olmalı. Sayı da bir
    // bilgidir — görülemeyen kaydın varlığını ele vermemeli (§18.4).
    expect(satirlar.find((s) => s.name === "Kalıphane")?.activityCount).toBe(1);
  });

  it("iptal edilmiş kayıt sayılmaz", async () => {
    const { direktor, kalipci } = await sirket();
    await faaliyetYaz(kalipci, "2026-08-18", "CANCELLED");

    const satirlar = await ozet(direktor.id);

    expect(satirlar.find((s) => s.name === "Kalıphane")?.activityCount).toBe(0);
  });

  it("dönem süzgeci sayıyı daraltır", async () => {
    const { direktor, kalipci } = await sirket();
    await faaliyetYaz(kalipci, "2026-08-18");
    await faaliyetYaz(kalipci, "2026-08-11");

    const buHafta = await ozet(direktor.id, "week");
    const tumu = await ozet(direktor.id, "all");

    expect(buHafta.find((s) => s.name === "Kalıphane")?.activityCount).toBe(1);
    expect(tumu.find((s) => s.name === "Kalıphane")?.activityCount).toBe(2);
  });

  it("astı olmayan için özet boştur", async () => {
    const { kalipci } = await sirket();

    expect(await ozet(kalipci.id)).toEqual([]);
  });

  it("üst yönetici alt dalları tek hiyerarşik toplamda görür", async () => {
    const { direktor, kalipci, planci, muhasebeci } = await sirket();
    const kok = await testDb.orgUnit.findFirstOrThrow({
      where: { parentId: null },
    });
    const kurul = await createUser(kok.id, {
      fullName: "Yönetim Kurulu",
      isUnitManager: true,
    });

    await faaliyetYaz(kalipci, "2026-08-18");
    await faaliyetYaz(planci, "2026-08-18");
    await faaliyetYaz(muhasebeci, "2026-08-18");

    const satirlar = await ozet(kurul.id, "week", true);

    expect(satirlar.map((s) => s.name)).toEqual([
      "Şirket",
      "Direktörlük",
      "Kalıphane",
      "Planlama",
      "Muhasebe",
    ]);
    expect(satirlar[0]).toMatchObject({
      people: 4,
      activityCount: 3,
      isRollup: true,
      depth: 0,
    });
    expect(satirlar[1]).toMatchObject({
      people: 3,
      activityCount: 2,
      isRollup: true,
      depth: 1,
    });
    expect(satirlar[2]).toMatchObject({
      people: 1,
      directPeople: 1,
      activityCount: 1,
      directActivityCount: 1,
      depth: 2,
    });
    expect(satirlar[4]).toMatchObject({
      people: 1,
      activityCount: 1,
      depth: 1,
    });
    expect(direktor.isUnitManager).toBe(true);
  });
});

describe("katılım sütunu (§12.1)", () => {
  it("ayar kapalıyken hiç hesaplanmaz", async () => {
    const { direktor, kalipci } = await sirket();
    await faaliyetYaz(kalipci, "2026-08-18");

    const satirlar = await ozet(direktor.id);

    expect(satirlar.every((s) => s.participation === null)).toBe(true);
  });

  it("ayar açıkken bugün yazanı sayar", async () => {
    const { direktor, kalipci } = await sirket();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await faaliyetYaz(kalipci, "2026-08-18");

    const satirlar = await ozet(direktor.id);

    expect(satirlar.find((s) => s.name === "Kalıphane")?.participation).toEqual({
      wrote: 1,
      expected: 1,
    });
    expect(satirlar.find((s) => s.name === "Planlama")?.participation).toEqual({
      wrote: 0,
      expected: 1,
    });
  });

  it("faaliyet yazması beklenmeyen kişi paydaya girmez", async () => {
    const { direktor, kalipci } = await sirket();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.update({
      where: { id: kalipci.id },
      data: { writesActivities: false },
    });

    const satirlar = await ozet(direktor.id);

    // Kişi sayısı yerinde durur (nötr bilgi), ama beklenti sıfır olduğu için
    // katılım sütunu çizilmez.
    const kaliphane = satirlar.find((s) => s.name === "Kalıphane");
    expect(kaliphane?.people).toBe(1);
    expect(kaliphane?.participation).toBeNull();
  });
});
