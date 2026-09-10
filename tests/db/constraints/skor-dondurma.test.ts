import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Dondurma kısıtlarının **reddetme** testleri (denetim 23.08.2026,
// P3-R2-4; proje kuralı: yeni kısıt eklendiğinde reddetme testi de eklenir).
//
// İki kural veritabanında duruyor:
//
//   · `UserScorePeriod_frozen_formula` — dondurulmuş dönem profili ve dört
//     ağırlığı taşımak zorunda. Taşımasaydı satır "donduruldu" der ama hangi
//     formülle okunacağı bilinmez ve okuma sessizce bugünkü ayara düşerdi:
//     tam da kapatılmak istenen hata.
//   · `UserScorePeriodFact_requires_frozen` — katkı yalnız dondurulmuş
//     döneme yazılabilir. Çapraz tablo kuralı olduğu için `CHECK` ile
//     ifade edilemiyor, tetikleyiciyle duruyor.
//
// Testler **uygulama katmanını atlıyor**: kısıtın değeri, yazan kodun devre
// dışı olduğu durumda da geçerli olmasında.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  const kayit = await createActivity(kadir, {
    activityDate: new Date("2026-07-15T00:00:00.000Z"),
  });
  return { kadir, kayit };
}

const TEMMUZ = new Date("2026-07-01T00:00:00.000Z");

function donem(userId: string, ek: Record<string, unknown>) {
  return {
    userId,
    periodStart: TEMMUZ,
    regularity: 40,
    followUp: 30,
    total: 70,
    expectedDays: 22,
    writtenDays: 20,
    ...ek,
  };
}

describe("dondurulmuş dönem formülünü taşımak zorunda", () => {
  it("profilsiz dondurulmuş dönem reddedilir", async () => {
    const { kadir } = await sahne();

    await expect(
      testDb.userScorePeriod.create({
        data: donem(kadir.id, {
          frozen: true,
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          weightFollowUp: 30,
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("ağırlığı eksik dondurulmuş dönem reddedilir", async () => {
    const { kadir } = await sahne();

    await expect(
      testDb.userScorePeriod.create({
        data: donem(kadir.id, {
          frozen: true,
          profile: "employee",
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          // `weightFollowUp` yok.
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("dondurulmamış döneme formül yazılamaz", async () => {
    const { kadir } = await sahne();

    // Ters yön de kapalı: eski model satırının formül taşıması, okumanın
    // hangi satıra güveneceğini belirsizleştirirdi.
    await expect(
      testDb.userScorePeriod.create({
        data: donem(kadir.id, { frozen: false, profile: "employee" }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("sürümsüz dondurulmuş dönem reddedilir", async () => {
    const { kadir } = await sahne();

    // Formül sürümü de mühürün parçası (P8-5): sürümsüz satır okunurken
    // bugünkü algoritmaya düşerdi.
    await expect(
      testDb.userScorePeriod.create({
        data: donem(kadir.id, {
          frozen: true,
          profile: "employee",
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          weightFollowUp: 30,
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("tam donmuş dönem kabul edilir", async () => {
    const { kadir } = await sahne();

    const yazilan = await testDb.userScorePeriod.create({
      data: donem(kadir.id, {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      }),
    });

    expect(yazilan.frozen).toBe(true);
  });
});

describe("katkı yalnız dondurulmuş döneme yazılabilir", () => {
  async function donemYaz(userId: string, frozen: boolean) {
    return testDb.userScorePeriod.create({
      data: donem(
        userId,
        frozen
          ? {
              frozen: true,
              profile: "employee",
              weightRegularity: 40,
              weightAcceptance: 30,
              weightApproval: 0,
              weightFollowUp: 30,
              formulaVersion: 1,
            }
          : { frozen: false },
      ),
    });
  }

  // **Yön ters çevrildi** (denetim 25.08.2026, P8-R2-1).
  //
  // Önce "katkı yalnız dondurulmuş döneme yazılabilir" deniyordu ve bu, tam
  // tersine, kapanış bittikten **günler sonra** aynı döneme yeni satır
  // eklenmesini serbest bırakıyordu. Başkasının kapanmış trendi katkılardan
  // yeniden hesaplandığı için tek bir satır tarihsel karneyi değiştirebilir.
  //
  // Değişmez olması gereken şey satır değil, **kümenin kendisi**. Kapanış
  // artık durum geçişli: taslak dönem (`frozen = false`) açılır, katkılar
  // ona yazılır, son adımda dönem mühürlenir. Mühürden sonra kümeye
  // dokunulamaz.
  /** Gerçek kapanışın yaptığı sıra: taslak aç, katkıyı yaz, mühürle. */
  async function donmusDonemVeKatki(userId: string, activityId: string) {
    await donemYaz(userId, false);
    const olgu = await testDb.userScorePeriodFact.create({
      data: {
        userId,
        periodStart: TEMMUZ,
        activityId,
        kind: "WRITTEN",
        happenedOn: new Date("2026-07-15T00:00:00.000Z"),
      },
    });
    await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: { userId, periodStart: TEMMUZ, revisionNo: 1 },
      },
      data: {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });
    return olgu;
  }

  it("dondurulmuş döneme katkı eklenemez", async () => {
    const { kadir, kayit } = await sahne();
    await donemYaz(kadir.id, true);

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: kadir.id,
          periodStart: TEMMUZ,
          activityId: kayit.id,
          kind: "WRITTEN",
          happenedOn: new Date("2026-07-15T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_FROZEN/);
  });

  it("taslak döneme katkı yazılır", async () => {
    const { kadir, kayit } = await sahne();
    await donemYaz(kadir.id, false);

    const olgu = await testDb.userScorePeriodFact.create({
      data: {
        userId: kadir.id,
        periodStart: TEMMUZ,
        activityId: kayit.id,
        kind: "WRITTEN",
        happenedOn: new Date("2026-07-15T00:00:00.000Z"),
      },
    });

    expect(olgu.onTime).toBe(true);
  });

  it("hesaplama anı da mühürlü", async () => {
    const { kadir } = await sahne();
    await donemYaz(kadir.id, true);

    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: kadir.id,
            periodStart: TEMMUZ,
            revisionNo: 1,
          },
        },
        data: { computedAt: new Date("2027-01-01T00:00:00.000Z") },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("katkı içeriği güncellenemez", async () => {
    const { kadir, kayit } = await sahne();
    const olgu = await donmusDonemVeKatki(kadir.id, kayit.id);

    await expect(
      testDb.userScorePeriodFact.update({
        where: { id: olgu.id },
        data: { onTime: false },
      }),
    ).rejects.toThrow(/SCORE_FACT_IMMUTABLE/);
  });

  it("katkı silinemez", async () => {
    const { kadir, kayit } = await sahne();
    const olgu = await donmusDonemVeKatki(kadir.id, kayit.id);

    await expect(
      testDb.userScorePeriodFact.delete({ where: { id: olgu.id } }),
    ).rejects.toThrow(/SCORE_FACT_IMMUTABLE/);
  });

  it("dönem sonradan çözülemez: katkı taşıyan satır dondurulmamış yapılamaz", async () => {
    const { kadir, kayit } = await sahne();
    await donmusDonemVeKatki(kadir.id, kayit.id);

    // **Bileşik çözme**: `frozen` düşürülüp formül kolonları aynı
    // güncellemede boşaltıldığında `CHECK` geçiyordu (denetim
    // 25.08.2026, P8-4). Önceki test yalnız `frozen: false` yazıp ağırlıkları
    // bırakıyordu, yani başka sebepten düşüyordu ve asıl kapıyı hiç
    // denemiyordu.
    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: kadir.id,
            periodStart: TEMMUZ,
            revisionNo: 1,
          },
        },
        data: {
          frozen: false,
          profile: null,
          weightRegularity: null,
          weightAcceptance: null,
          weightApproval: null,
          weightFollowUp: null,
        },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("donmuş dönemin payda ve sonucu değiştirilemez", async () => {
    const { kadir } = await sahne();
    await donemYaz(kadir.id, true);

    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: kadir.id,
            periodStart: TEMMUZ,
            revisionNo: 1,
          },
        },
        data: { expectedDays: 1, total: 100 },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("donmuş dönem silinemez", async () => {
    const { kadir } = await sahne();
    await donemYaz(kadir.id, true);

    await expect(
      testDb.userScorePeriod.delete({
        where: {
          userId_periodStart_revisionNo: {
            userId: kadir.id,
            periodStart: TEMMUZ,
            revisionNo: 1,
          },
        },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("donmamış dönem hâlâ düzeltilebilir", async () => {
    const { kadir } = await sahne();
    await donemYaz(kadir.id, false);

    // Mühür yalnız donduktan sonra iner; eski model satırının düzeltilmesi
    // engellenmiyor.
    const guncel = await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: {
          userId: kadir.id,
          periodStart: TEMMUZ,
          revisionNo: 1,
        },
      },
      data: { total: 71 },
    });
    expect(guncel.total).toBe(71);
  });
});
