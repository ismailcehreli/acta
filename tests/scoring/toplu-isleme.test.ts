import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeScorePeriod,
  drainScorePeriodWork,
} from "@/server/scoring/close-period";
import { approveActivity } from "@/server/activities/approval";
import { createActivity as createActivityService } from "@/server/activities/write";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// P8-R4-1 — işçi tek kişi-ay düzeltmesiyle dakikalarca beklememeli.
// Her düzeltme ayrı transaction olarak kalır; toplulaştırma yalnız aynı turda
// kaç bağımsız işin ardışık alınacağını belirler.

const KAPANIS = new Date("2026-08-03T06:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kapatilmisKisiler(count: number) {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kisiler = await Promise.all(Array.from(
    { length: count },
    (_, index) => createUser(birim.id, { fullName: `Çalışan ${index + 1}` }),
  ));

  for (const kisi of kisiler) {
    await createActivity(kisi, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
  }
  await closeScorePeriod(testDb, KAPANIS);

  await testDb.scoreRecalculationRequest.createMany({
    data: kisiler.map((kisi) => ({
      userId: kisi.id,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      sourceType: "TEST_BATCH",
      sourceId: kisi.id,
      requestedAt: new Date("2026-08-10T09:00:00.000Z"),
    })),
  });

  return kisiler;
}

describe("skor düzeltme toplu işleme", () => {
  it("işçinin gerçek varsayılanıyla ilk turda 20, ikinci turda kalan işi işler", async () => {
    await kapatilmisKisiler(21);

    // Seçenek verilmez: worker'ın `drainScorePeriodWork(prisma, now)` çağrısı
    // da tam bu varsayılanları kullanır.
    const ilk = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T10:00:00.000Z"),
    );

    expect(ilk).toMatchObject({ processed: 20, written: 20, exhaustedItemBudget: true });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(1);

    const ikinci = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T10:01:00.000Z"),
    );
    expect(ikinci).toMatchObject({ processed: 1, written: 1, exhaustedItemBudget: false });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
  });

  it("puan kapsamı dışındaki kişinin geç onayı skor isteği üretmez", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: true,
    });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const puansiz = await createUser(birim.id, {
      fullName: "Puan Dışı Çalışan",
      isScored: false,
    });

    const kayit = await createActivityService(
      testDb,
      { id: puansiz.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: "2026-07-15",
        title: "Onay bekleyen faaliyet",
        description: "Geç onay kuyruğu testi.",
        targetDepartmentIds: [],
      },
      new Date("2026-07-15T09:00:00.000Z"),
    );
    expect(kayit.ok).toBe(true);
    if (!kayit.ok) return;

    await closeScorePeriod(testDb, KAPANIS);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: puansiz.id } }),
    ).toBe(0);

    expect(
      (await approveActivity(testDb, mudur.id, kayit.activity.id, new Date("2026-08-03T09:00:00.000Z"))).ok,
    ).toBe(true);
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { userId: puansiz.id } }),
    ).toBe(0);
  });

  it("eski karne-yok isteği geçerli isteği kuyrukta bloke etmez", async () => {
    const [puanli] = await kapatilmisKisiler(1);
    const puansiz = await createUser(puanli.orgUnitId, {
      fullName: "Eski Kuyruk Kaydı",
      isScored: false,
    });

    // Migration öncesinden/elle müdahaleden kalmış karne-yok isteğini doğrudan
    // kuruyoruz: fiziksel silme yapmadan, satırı hiç oluşmamış kişi seçiliyor.
    await testDb.scoreRecalculationRequest.createMany({
      data: [
        {
          userId: puansiz.id,
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          sourceType: "LEGACY_NO_PERIOD",
          sourceId: puansiz.id,
          requestedAt: new Date("2026-08-10T08:00:00.000Z"),
        },
      ],
    });

    const sonuc = await drainScorePeriodWork(testDb, new Date("2026-08-10T10:00:00.000Z"));
    expect(sonuc).toMatchObject({ processed: 2, written: 1 });
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: puanli.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      }),
    ).toBe(2);
  });
});
