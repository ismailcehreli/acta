import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity as createActivityService } from "@/server/activities/write";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Dönem, **yeni kayıt kabul penceresi kapanmadan** dondurulmaz
// (denetim 25.08.2026, P8-R2-2).
//
// §5.6 bugün ve dün için faaliyet girişini açıkça kabul ediyor. Kapanış ise
// yeni ayın ilk dakikasında önceki ayı değişmez kılıyor ve sonraki turlarda
// mevcut satırı koşulsuz atlıyordu: 1 Ağustos 00:01'de Temmuz kapanıyor,
// 00:10'da kurala uygun girilen 31 Temmuz kaydı karneye hiç giremiyordu.
// Bu uç bir yarış değil — her ayın ilk günü varsayılan ayarla **açık bir
// yazma penceresi**.

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  return { birim, kadir };
}

/** Dönem sonu ayar görüntüsü; gerçek ayar yazısının ürettiği append-only olay. */
async function geriyeGirisOlayi(value: string, effectiveAt: Date) {
  await testDb.scoreSettingEvent.create({
    data: {
      key: SETTING_KEYS.retroactiveEntryDays,
      value,
      effectiveAt,
      reason: "TEST_PERIOD_END_SETTING",
    },
  });
}

describe("kapanış, geriye giriş penceresini bekler", () => {
  it("ayın ilk gününde Temmuz henüz kapanmaz", async () => {
    await sirket();

    // 1 Ağustos 00:01 şirket saati. Varsayılan ayarla 31 Temmuz kaydı hâlâ
    // girilebilir; dönem dondurulamaz.
    const sonuc = await closeScorePeriod(
      testDb,
      new Date("2026-07-31T21:01:00.000Z"),
    );

    expect(sonuc.periodStart).toBeNull();
    expect(sonuc.written).toBe(0);
    expect(await testDb.userScorePeriod.count()).toBe(0);
  });

  it("pencere kapandıktan sonra girilen dün kaydı karneye girer", async () => {
    const { birim, kadir } = await sirket();

    // 1 Ağustos 03:10 şirket saati: kural gereği 31 Temmuz kaydı kabul edilir.
    const yazildi = await createActivityService(
      testDb,
      { id: kadir.id, orgUnitId: birim.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Ayın son günü yazılan kayıt",
        description: "Ertesi gün girilen, kurala uygun kayıt.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-01T00:10:00.000Z"),
    );
    expect(yazildi.ok, "kural bu kaydı kabul ediyor (§5.6)").toBe(true);

    // Kapanış artık pencere kapandıktan sonra koşuyor: 2 Ağustos.
    const sonuc = await closeScorePeriod(
      testDb,
      new Date("2026-08-02T00:10:00.000Z"),
    );
    expect(sonuc.periodStart).toBe("2026-07-01");

    const olgular = await testDb.userScorePeriodFact.count({
      where: { userId: kadir.id, kind: "WRITTEN" },
    });
    expect(olgular, "ertesi gün girilen kayıt Temmuz'a sayılmalı").toBe(1);
  });

  it("geriye giriş ayarı büyükse kapanış daha da bekler", async () => {
    await sirket();
    await geriyeGirisOlayi("5", new Date("2026-07-31T20:59:00.000Z"));

    // 3 Ağustos: beş günlük pencere hâlâ açık.
    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-03T06:00:00.000Z")))
        .periodStart,
    ).toBeNull();

    // 6 Ağustos: 31 Temmuz artık girilemez, dönem kapanabilir.
    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-06T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
  });

  it("sonraki ay büyütülen ayar önceki dönemi yeniden açmaz", async () => {
    await sirket();
    // Temmuz biterken kural 1 gündü.
    await geriyeGirisOlayi("1", new Date("2026-07-31T20:59:00.000Z"));
    // Ağustos'ta kural 5 güne çıktı; bu yalnız Ağustos dönemini etkiler.
    await geriyeGirisOlayi("5", new Date("2026-08-01T09:00:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "5" });

    const sonuc = await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
    );
    expect(sonuc.periodStart).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 1 });
  });

  it("sonraki ay küçültülen ayar dönem sonundaki uzun pencereyi kısaltmaz", async () => {
    await sirket();
    // Temmuz biterken kural 5 gündü.
    await geriyeGirisOlayi("5", new Date("2026-07-31T20:59:00.000Z"));
    // Ağustos'ta kural 1 güne indi; Temmuz yine beş günü beklemeli.
    await geriyeGirisOlayi("1", new Date("2026-08-01T09:00:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "1" });

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z")))
        .periodStart,
    ).toBeNull();
    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-06T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 5 });
  });

  it("şirket saatinde yeni aya ait ayarı önceki döneme taşımaz", async () => {
    await sirket();
    await geriyeGirisOlayi("1", new Date("2026-07-31T20:59:00.000Z"));

    // 1 Ağustos 00:30 İstanbul saati, UTC'de hâlâ 31 Temmuz 21:30'dur.
    // Kesim UTC tarihiyle değil şirket günüyle yapılmalıdır.
    await geriyeGirisOlayi("5", new Date("2026-07-31T21:30:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "5" });

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 1 });
  });
});

// **Dönemde var olmayan kişiye karne yazılmaz** (denetim 25.08.2026,
// P8-R2-3).
//
// Kapanış yalnız "o an aktif, skorlanan, faaliyet yazan" kişileri seçiyordu.
// İşçinin her dakika **denemesi** başarı penceresini bir dakika yapmaz: süreç
// kapalı olabilir, dağıtım sürebilir, önceki adım gecikebilir. Gecikmiş bir
// kapanış, dönemden sonra açılmış bir kullanıcıya geçmiş dönem karnesi
// yazıyordu — kişi o dönemde mevcut bile değilken.
describe("gecikmiş kapanış", () => {
  it("dönemden sonra açılan kişiye geçmiş karne yazılmaz", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });

    const eski = await createUser(birim.id, { fullName: "Eski Çalışan" });
    // 25 Ağustos'ta açılan kişi: Temmuz'da yoktu.
    const yeni = await createUser(birim.id, { fullName: "Yeni Çalışan" });
    await testDb.user.update({
      where: { id: yeni.id },
      data: { createdAt: new Date("2026-08-25T09:00:00.000Z") },
    });

    // Kapanış gecikti: Temmuz, 25 Ağustos'ta kapanıyor.
    const sonuc = await closeScorePeriod(
      testDb,
      new Date("2026-08-25T12:00:00.000Z"),
    );
    expect(sonuc.periodStart).toBe("2026-07-01");

    expect(
      await testDb.userScorePeriod.count({ where: { userId: eski.id } }),
      "dönemde vardı",
    ).toBe(1);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: yeni.id } }),
      "dönemde yoktu",
    ).toBe(0);
  });

  it("dönem içinde açılan kişiye karne yazılır", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const kisi = await createUser(birim.id, { fullName: "Temmuzda Başlayan" });
    await testDb.user.update({
      where: { id: kisi.id },
      data: { createdAt: new Date("2026-07-20T09:00:00.000Z") },
    });

    await closeScorePeriod(testDb, new Date("2026-08-25T12:00:00.000Z"));

    expect(
      await testDb.userScorePeriod.count({ where: { userId: kisi.id } }),
    ).toBe(1);
  });
});
