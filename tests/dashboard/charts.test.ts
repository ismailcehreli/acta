import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { activityTrend, statusDistribution } from "@/server/dashboard/charts";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// TREND GRAFİĞİ ŞİRKET TAKVİMİNE BAĞLI (denetim 21.08.2026, bulgu 13).
//
// `activityTrend` "çalışma günü" tanımını koda gömülü bir cumartesi-pazar
// kontrolünden alıyordu. Şirketin kendi takvimini (§12.1) hiç okumuyordu:
// cumartesi çalışan bir yerde ortalama yanlış çıkıyor, hafta içine denk gelen
// resmî tatil "kayıt girilmemiş çalışma günü" olarak sayılıyordu.
//
// Bulgunun asıl dersi şu: bu yol için **hiç test yoktu.** Denetim
// `haftaSonu()` fonksiyonunu her gün için `false` döndürecek şekilde bozdu
// ve mevcut 30
// dashboard testinin tamamı yine geçti. "Test var" ile "üretim yolu korunuyor"
// aynı şey değil.

const NOW = new Date("2026-08-22T12:00:00.000Z"); // Cumartesi

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  const kisi = await createUser(kok.id, { email: "kisi@ornek.test" });
  return { kok, kisi };
}

/** Şirket takvimini kurar; kayıt yoksa hafta içi varsayılanı işler. */
async function takvimKur(workingDays: number[]) {
  await testDb.workCalendar.upsert({
    where: { id: 1 },
    create: { id: 1, workingDays, workStartMinute: 8 * 60, workEndMinute: 17 * 60 },
    update: { workingDays },
  });
}

function viewer(id: string) {
  return { id, isSystemAdmin: false };
}

describe("çalışma günü tanımı ayardan gelir", () => {
  it("cumartesi çalışan şirkette cumartesi ortalamaya girer", async () => {
    const { kisi } = await sahne();
    // Yalnız cumartesi çalışılıyor.
    await takvimKur([6]);

    await createActivity(kisi, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-22T00:00:00.000Z"), // Cumartesi
    });

    const trend = await activityTrend(testDb, viewer(kisi.id), [], 2, NOW);

    expect(trend.total).toBe(1);
    // Sabit hafta sonu varsayımıyla bu 0 çıkıyordu: cumartesi "çalışma günü
    // değil" sayıldığı için payda boş kalıyordu.
    expect(trend.workdayAverage).toBe(1);
  });

  it("hafta içine denk gelen resmî tatil çalışma günü sayılmaz", async () => {
    const { kisi } = await sahne();
    await takvimKur([1, 2, 3, 4, 5]);

    // 20 Ağustos 2026 Perşembe; tatil ilan ediliyor.
    await testDb.holiday.create({
      data: { date: new Date("2026-08-20T00:00:00.000Z"), description: "Tatil" },
    });

    // 19 Ağustos Çarşamba'ya bir kayıt; 20 Ağustos boş.
    await createActivity(kisi, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
    });

    const trend = await activityTrend(
      testDb,
      viewer(kisi.id),
      [],
      4,
      new Date("2026-08-21T12:00:00.000Z"), // Cuma
    );

    // 18, 19, 20, 21 → tatil olan 20 çıkınca üç çalışma günü kalır ve
    // yalnız biri boş değildir.
    expect(trend.emptyWorkdays).toBe(2);
  });

  it("takvim kaydı yoksa hafta içi varsayılanı işler", async () => {
    const { kisi } = await sahne();

    await createActivity(kisi, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"), // Cuma
    });

    const trend = await activityTrend(
      testDb,
      viewer(kisi.id),
      [],
      2,
      new Date("2026-08-22T12:00:00.000Z"), // Cumartesi
    );

    // 21 Cuma (çalışma günü) + 22 Cumartesi (değil) → payda 1.
    expect(trend.workdayAverage).toBe(1);
  });
});

describe("grafik görünürlük kapsamının dışına taşmaz", () => {
  it("başkasının kaydı toplama girmez", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ" });
    const bir = await createUser(kok.id, { email: "bir@ornek.test" });
    const iki = await createUser(kok.id, { email: "iki@ornek.test" });

    await createActivity(iki, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });

    const trend = await activityTrend(testDb, viewer(bir.id), [], 3, NOW);

    // Bir çubuğun yüksekliği bile bilgidir: akran kaydı sayıya eklenemez.
    expect(trend.total).toBe(0);
  });

  it("yönetim grafikleri yöneticinin kendi kaydını saymaz", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ" });
    const manager = await createUser(kok.id, {
      email: "manager@ornek.test",
      isUnitManager: true,
    });
    const worker = await createUser(kok.id, { email: "worker@ornek.test" });

    await createActivity(manager, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });
    await createActivity(worker, {
      approvalStatus: "APPROVED",
      activityDate: new Date("2026-08-21T00:00:00.000Z"),
    });

    const subordinates = [worker.id];
    const trend = await activityTrend(
      testDb,
      viewer(manager.id),
      subordinates,
      3,
      NOW,
      { managedOnly: true },
    );
    const statuses = await statusDistribution(
      testDb,
      viewer(manager.id),
      subordinates,
      new Date("2026-08-17T00:00:00.000Z"),
      { managedOnly: true },
    );

    expect(trend.total).toBe(1);
    expect(statuses).toEqual([{ status: "APPROVED", count: 1 }]);
  });
});

describe("iptal ve ret eğilim çizgisine girmez (karar 03.09.2026)", () => {
  it("iptal ve reddedilen kayıt eğilimde sayılmaz, durum dağılımında görünür", async () => {
    // İki grafiğin iki ayrı sorusu var: eğilim "ne kadar iş yapıldı" diyor,
    // dağılım "kayıtlar hangi durumda" diyor. İkincisinden iptal ve reddi
    // çıkarmak, grafiği kendi sorusuna cevap veremez hâle getirirdi.
    const kok = await createOrgUnit({ name: "Acta HQ" });
    const mudur = await createUser(kok.id, {
      email: "mudur@ornek.test",
      isUnitManager: true,
    });
    const kisi = await createUser(kok.id, { email: "kayit@ornek.test" });
    const gun = new Date("2026-08-21T00:00:00.000Z");
    const gerekce = await createApprovalReason("REJECTED");

    await createActivity(kisi, { approvalStatus: "APPROVED", activityDate: gun });
    await createActivity(kisi, { approvalStatus: "CANCELLED", activityDate: gun });
    await createActivity(kisi, {
      approvalStatus: "REJECTED",
      activityDate: gun,
      approverId: mudur.id,
      approvalReasonId: gerekce.id,
      approvalReasonKind: "REJECTED",
    });

    const trend = await activityTrend(testDb, viewer(kisi.id), [], 3, NOW);
    const statuses = await statusDistribution(
      testDb,
      viewer(kisi.id),
      [],
      new Date("2026-08-17T00:00:00.000Z"),
    );

    expect(trend.total).toBe(1);
    expect(statuses.reduce((toplam, dilim) => toplam + dilim.count, 0)).toBe(3);
  });
});
