import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Skor dönemi satırının veritabanı kısıtları (denetim 23.08.2026,
// bulgu 15).
//
// Geçiş `UserScorePeriod_valid_scores` ve `UserScorePeriod_valid_days`
// kısıtlarını ekliyordu ama hiçbir test geçersiz satır yazmayı denemiyordu:
// kısıtın adı değişse, migration'dan satır düşse ya da ifade gevşese bütün
// testler yine geçerdi. Projenin "iş kuralı veritabanında da durur" iddiası
// bu iki kısıt için kanıtsızdı.
//
// Testler **uygulama katmanını atlıyor**: kısıtın değeri, hesap yazan kodun
// devre dışı olduğu durumda da geçerli olmasında.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisi() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  return createUser(birim.id, { fullName: "Kadir Usta" });
}

/**
 * Geçerli bir dönem satırı; testler yalnız **tek** alanı bozuyor.
 *
 * Bütün alanların geçerli kalması önemli: eksik bir zorunlu alan ya da
 * yabancı anahtar hatası testi yanlış sebepten yeşile çevirirdi.
 */
function satir(userId: string, bozukluk: Record<string, number | null>) {
  return {
    userId,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    regularity: 50,
    acceptance: 20,
    approval: null as number | null,
    followUp: 10,
    total: 80,
    expectedDays: 20,
    writtenDays: 10,
    ...bozukluk,
  };
}

describe("puan aralığı kısıtı", () => {
  it("100'ün üstündeki düzenlilik puanı reddedilir", async () => {
    const kadir = await kisi();

    await expect(
      testDb.userScorePeriod.create({ data: satir(kadir.id, { regularity: 120 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });

  it("negatif takip puanı reddedilir", async () => {
    const kadir = await kisi();

    await expect(
      testDb.userScorePeriod.create({ data: satir(kadir.id, { followUp: -1 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });

  it("takdir katkısıyla 100'ün üstündeki genel puan kabul edilir", async () => {
    const kadir = await kisi();

    const donem = await testDb.userScorePeriod.create({
      data: satir(kadir.id, {
        regularity: 70,
        total: 101,
        appreciationPointsPer: 1,
      }),
    });

    expect(donem.total).toBe(101);
  });

  it("boş bırakılabilen boyut aralık dışıysa yine reddedilir", async () => {
    const kadir = await kisi();

    // `acceptance` ve `approval` boş olabilir; **dolu** olduklarında aralık
    // kuralı onlara da işler.
    await expect(
      testDb.userScorePeriod.create({ data: satir(kadir.id, { approval: 150 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });
});

describe("gün kısıtı", () => {
  it("negatif beklenen gün reddedilir", async () => {
    const kadir = await kisi();

    await expect(
      testDb.userScorePeriod.create({
        data: satir(kadir.id, { expectedDays: -1, writtenDays: 0 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("paydayı aşan pay reddedilir", async () => {
    const kadir = await kisi();

    // "20 iş gününün 25'inde yazdı" anlamsızdır.
    await expect(
      testDb.userScorePeriod.create({
        data: satir(kadir.id, { expectedDays: 20, writtenDays: 25 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("negatif yazılan gün reddedilir", async () => {
    const kadir = await kisi();

    await expect(
      testDb.userScorePeriod.create({
        data: satir(kadir.id, { writtenDays: -1 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("geçerli satır kabul edilir", async () => {
    const kadir = await kisi();

    // Karşı kanıt: yukarıdaki retler alan eksikliğinden değil, kısıttan.
    const yazilan = await testDb.userScorePeriod.create({
      data: satir(kadir.id, {}),
    });

    expect(yazilan.total).toBe(80);
  });
});
