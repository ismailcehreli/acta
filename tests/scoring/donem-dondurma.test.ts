import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { cancelActivity } from "@/server/activities/cancel";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SCORE_CALCULATORS } from "@/server/scoring/compute";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// **Kapanmış dönem donuktur** (denetim 23.08.2026, P3-R2-4).
//
// Önce ne vardı: başkasının profiline bakan kişi için kapanmış dönem her
// okumada canlı tablolardan yeniden hesaplanıyordu. Yeniden hesap **bugünün**
// verisiyle yapılıyordu, dolayısıyla aynı tarihçe farklı günlerde farklı
// toplam veriyordu:
//
//   · faaliyet eylülde onaylanırsa ağustosun kabul oranı değişiyordu,
//   · faaliyet sonradan iptal edilirse ağustosun yazılan günü düşüyordu,
//   · izin sonradan iptal edilirse ağustosun paydası büyüyordu,
//   · takvime tatil eklenirse payda değişiyordu,
//   · kişi yönetici yapılırsa ağustos yönetici profiliyle hesaplanıyordu,
//   · ağırlık ayarı değişirse bütün geçmiş yeni formülle hesaplanıyordu.
//
// Kişi kendi donmuş satırını görürken yöneticisi değişen bir sayı görüyordu;
// "neden 64" sorusunun kalıcı cevabı yoktu.
//
// Buradaki testlerin hepsi aynı kalıptadır: dönemi kapat, **başka bakanın**
// gördüğü toplamı ölç, sonra dünyayı değiştir ve aynı toplamı yeniden ölç.
// Sayı değişirse dondurma yok demektir.

// Kapanış, geriye giriş penceresi kapandıktan sonra koşar (P8-R2-2):
// varsayılan ayarla 31 Temmuz kaydı 1 Ağustos'ta hâlâ girilebiliyor.
const KAPANIS = new Date(Date.UTC(2026, 7, 3, 6, 0, 0)); // 1 Ağustos: Temmuz'u kapatır
const TEMMUZ = "2026-07-01";

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });
  const genelMudur = await createUser(kok.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const mudur = await createUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });

  return { kok, birim, genelMudur, mudur, kadir };
}

/**
 * Bir bakanın gördüğü Temmuz toplamı.
 *
 * Dondurma testlerinde bakan **müdür**: onay bekleyen kaydı da onaylanmış
 * kaydı da görüyor. Genel Müdür'le ölçmek iki ayrı kuralı karıştırırdı —
 * *görünürlük bugünden* gelir (§4.6) ve geç verilen onay kaydı Genel
 * Müdür'ün kapsamına **sokar**. Değişen şey verinin kendisi değil, kimin
 * gördüğüdür; alttaki "görünürlük" bölümü bunu ayrıca sınıyor.
 */
async function temmuzToplami(bakanId: string, kisiId: string): Promise<number | null> {
  const trend = await readScoreTrend(
    testDb,
    { id: bakanId, isSystemAdmin: false },
    kisiId,
  );
  return trend.periods.find((d) => d.periodStart === TEMMUZ)?.total ?? null;
}

describe("kapanmış dönem donuktur", () => {
  it("dönemden sonra verilen onay geçmişi değiştirmez", async () => {
    const { mudur, kadir } = await sirket();

    // Temmuz'da yazılmış, hâlâ onay bekleyen bir kayıt.
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);
    expect(once).not.toBeNull();

    // Ağustos'ta onaylanıyor: Temmuz'un kabul oranı **değişmemeli**.
    const karar = await approveActivity(
      testDb,
      mudur.id,
      kayit.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(karar.ok).toBe(true);

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });

  it("dönemden sonra yapılan iptal geçmişi değiştirmez", async () => {
    const { mudur, kadir } = await sirket();

    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await createActivity(kadir, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);

    const iptal = await cancelActivity(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kayit.id,
      "Mükerrer kayıt olduğu anlaşıldı.",
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(iptal.ok).toBe(true);

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });

  it("sonradan iptal edilen izin paydayı büyütmez", async () => {
    const { mudur, kadir } = await sirket();

    // Kişi izin **dışındaki** günlerde yazıyor: pay dolu, dolayısıyla payda
    // değişirse oran da değişir. Yalnız izinli günde yazılmış tek bir kayıtla
    // kurulan hâli hiçbir şey kanıtlamıyordu — pay sıfır olduğu için payda
    // ne olursa olsun sonuç aynı çıkıyordu (24.08.2026'da geri alma
    // denemesinde görüldü).
    for (const gun of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    const izin = await testDb.noActivityPeriod.create({
      data: {
        userId: kadir.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-10T00:00:00.000Z"),
        markedById: kadir.id,
      },
    });

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);

    // İzin sonradan iptal ediliyor: dönem hiç yaşanmamış sayılıyor ve payda
    // canlı hesapta büyüyor. Kapanmış dönem bundan **etkilenmemeli**.
    await testDb.noActivityPeriod.update({
      where: { id: izin.id },
      data: {
        cancelledAt: new Date("2026-08-10T09:00:00.000Z"),
        cancelledById: kadir.id,
        cancellationReason: "Yanlış girilmiş.",
      },
    });

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });

  it("sonradan eklenen resmî tatil paydayı değiştirmez", async () => {
    const { mudur, kadir } = await sirket();

    // Pay dolu olmalı ki payda değişimi orana yansısın; tek kayıtla kurulan
    // hâli ayırt etmiyordu.
    for (const gun of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);

    // Beş iş günü tatil ilan ediliyor: canlı hesapta payda belirgin biçimde
    // küçülür ve oran yükselirdi.
    for (const gun of [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]) {
      await testDb.holiday.create({
        data: {
          date: new Date(`${gun}T00:00:00.000Z`),
          description: "Sonradan eklenen tatil",
        },
      });
    }

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });

  it("kişi sonradan yönetici olursa geçmiş dönem profili değişmez", async () => {
    const { mudur, kadir } = await sirket();

    // İki kayıt: biri onaylı, biri onay bekliyor. Kabul oranı böylece
    // **ölçülebilir** oluyor (1/2) ve çalışan profili ile yönetici profili
    // farklı sayı üretiyor: yöneticide kabul oranı yok, yerine onay süresi
    // var ve kararı olmayan yönetici o boyuttan tam puan alıyor.
    //
    // Bu ayrım olmadan test hiçbir şey kanıtlamıyordu: veri yokken iki
    // profil de aynı toplamı veriyor ve profil dondurulmasa bile test
    // yeşil kalıyordu (24.08.2026'da geri alma denemesinde görüldü).
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await createActivity(kadir, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-16T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);

    // Yönetici profili farklı ağırlıklar kullanıyor. Geçmiş dönem o günkü
    // profille okunmalı.
    await testDb.user.update({
      where: { id: kadir.id },
      data: { isUnitManager: true },
    });

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });

  it("ağırlık ayarı değişince geçmiş dönemler yeniden hesaplanmaz", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);
    const once = await temmuzToplami(mudur.id, kadir.id);

    const kaydedildi = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "10",
      [SETTING_KEYS.scoringWeightAcceptance]: "60",
      [SETTING_KEYS.scoringWeightApproval]: "60",
      [SETTING_KEYS.scoringWeightFollowUp]: "30",
    });
    expect(kaydedildi.ok).toBe(true);

    expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
  });
});

describe("dondurma görünürlüğü delmez", () => {
  it("görülemeyen kayıt bakanın toplamına girmez", async () => {
    const { genelMudur, mudur, kadir } = await sirket();

    // Onay bekleyen kayıt yalnız **aktif onaylayıcıya** görünür (§8.2);
    // Genel Müdür onu göremez.
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);

    const kendi = await temmuzToplami(kadir.id, kadir.id);
    const genelMudurun = await temmuzToplami(genelMudur.id, kadir.id);

    // Kişinin kendi satırı kaydı sayıyor; Genel Müdür göremediği için
    // saymıyor. İki sayı **farklı** olmalı: aynı çıksaydı toplam, görülmeyen
    // kaydın etkisini taşıyor demekti (§18.4).
    //
    // Yön iddiası yok, çünkü boş payda tam puan veriyor (`puan(0, 0)`):
    // hiçbir şey görmeyen bakan daha **yüksek** sayı görebilir. Bu ayrı bir
    // konu ve bu paketin kapsamında değil; sızıntı açısından zararsız —
    // görülmeyen kayıt sayıya hiç girmiyor.
    expect(kendi).not.toBe(genelMudurun);
  });

  it("eski model dönemleri hiçbir bakana gösterilmez", async () => {
    const { genelMudur, kadir } = await sirket();

    // Dondurma öncesinden kalmış satır: katkısı yok.
    await testDb.userScorePeriod.create({
      data: {
        userId: kadir.id,
        periodStart: new Date(`${TEMMUZ}T00:00:00.000Z`),
        regularity: 40,
        followUp: 30,
        total: 70,
        expectedDays: 22,
        writtenDays: 20,
      },
    });

    expect(await temmuzToplami(kadir.id, kadir.id)).toBeNull();
    expect(await temmuzToplami(genelMudur.id, kadir.id)).toBeNull();
  });
});

// Formül **sürümü** de donuyor (denetim 25.08.2026, P8-5).
//
// Ağırlıkları dondurmak yetmiyordu: donmuş olgular bugünkü `computeScore`
// işlevine gönderiliyordu. Yuvarlama, boş payda davranışı, boyut tanımı ya da
// profil eşlemesi ileride değişirse kişinin kendi gördüğü saklanmış `total`
// aynı kalır, yöneticisinin gördüğü aynı dönem **değişirdi**. Paket tam
// olarak bunun olmaması için yazıldı.
describe("formül sürümü donuyor", () => {
  it("yeni bir formül sürümü V1 dönemini değiştirmez", async () => {
    const { mudur, kadir } = await sirket();
    for (const gun of ["2026-07-15", "2026-07-16"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, KAPANIS, { formulaVersion: 1 });
    const once = await temmuzToplami(mudur.id, kadir.id);
    expect(once).not.toBeNull();

    // Formül düzeltmesini taklit ediyoruz: **yeni bir sürüm** eklendi.
    // Mevcut V1 dokunulmadı; kapanmış dönem onu kullanmaya devam etmeli.
    const eskiV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = () => ({
      regularity: 0,
      acceptance: null,
      approval: null,
      followUp: 0,
      total: 0,
    });

    try {
      expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
    } finally {
      SCORE_CALCULATORS[2] = eskiV2;
    }
  });

  it("tanınmayan sürümdeki dönem hiç gösterilmez", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await closeScorePeriod(testDb, KAPANIS);

    // Gelecekten gelmiş bir satır: bu sürümü okuyacak hesaplayıcı yok.
    // Bugünkü algoritmaya düşmek geçmişi sessizce yeniden yorumlamak olurdu;
    // dönem hiç gösterilmiyor.
    await testDb.$executeRaw`
      ALTER TABLE "UserScorePeriod" DISABLE TRIGGER "UserScorePeriod_frozen_immutable"`;
    await testDb.userScorePeriod.updateMany({
      where: { userId: kadir.id },
      data: { formulaVersion: 99 },
    });
    await testDb.$executeRaw`
      ALTER TABLE "UserScorePeriod" ENABLE TRIGGER "UserScorePeriod_frozen_immutable"`;

    // **İki bakan için de**: sahibi ile yöneticisinin farklı görmesi, tam
    // olarak kapatılmak istenen tutarsızlık (P8-R2-4).
    expect(await temmuzToplami(mudur.id, kadir.id), "yönetici").toBeNull();
    expect(await temmuzToplami(kadir.id, kadir.id), "sahibi").toBeNull();
  });

  it("V2 gerçekten farklı sonuç verirken V1 dönemi değişmez", async () => {
    const { mudur, kadir } = await sirket();
    for (const gun of ["2026-07-15", "2026-07-16"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, KAPANIS, { formulaVersion: 1 });
    const once = await temmuzToplami(mudur.id, kadir.id);
    expect(once).not.toBeNull();

    // V2 aynı girdiyle **farklı** bir sonuç üretiyor; V1 dönemi ona
    // dokunmamalı. Önceki hâlde test yalnız kullanılmayan bir anahtar
    // ekliyordu ve `formulaVersion` tamamen yok sayılsa bile yeşil kalırdı.
    const eskiV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = (profil, girdi, agirliklar) => {
      const v1 = SCORE_CALCULATORS[1]!(profil, girdi, agirliklar);
      return { ...v1, regularity: 0, total: v1.total - v1.regularity };
    };

    try {
      // Aynı girdiyle V2 farklı sonuç veriyor mu — testin kendisi anlamlı
      // olsun diye doğrulanıyor.
      const ornek = {
        expectedDays: 20,
        writtenDays: 10,
        writtenCount: 10,
        approvedCount: 5,
        decidedCount: 0,
        decidedOnTimeCount: 0,
        followUpTotal: 0,
        followUpHandled: 0,
      };
      const agirlik = {
        regularity: 60,
        acceptance: 30,
        approval: 30,
        followUp: 10,
      };
      expect(SCORE_CALCULATORS[2]!("employee", ornek, agirlik).total).not.toBe(
        SCORE_CALCULATORS[1]!("employee", ornek, agirlik).total,
      );

      expect(await temmuzToplami(mudur.id, kadir.id)).toBe(once);
    } finally {
      SCORE_CALCULATORS[2] = eskiV2;
    }
  });
});

// **Dönem sonu gerçeği, kapanış anındaki gerçek değil** (denetim
// 25.08.2026, P8-2).
//
// Önceki testler mutasyonu kapanıştan **sonra** yapıyordu ve hepsi geçiyordu.
// Asıl pencere başka: dönem bitti, işçi henüz koşmadı. Kapanış o an aktif
// kişileri, o anki durumu ve o anki izinleri okuduğu için 1 Ağustos 03:30'da
// verilen bir onay Temmuz'a `ACCEPTED` olgusu yazıyor, geç iptal kaydı
// tamamen düşürüyor, dönem bittikten sonra iptal edilen izin paydaya geri
// dönüyordu.
//
// Tasarım notunun ilkesi: *görünürlük bugünden, veri dönem sonundan.*
describe("dönem sonundan sonra, kapanıştan önce olanlar geçmişe girmez", () => {
  const DONEM_SONRASI = new Date("2026-08-01T00:30:00.000Z"); // 03:30 şirket saati

  it("dönem bittikten sonra verilen onay kabul sayılmaz", async () => {
    const { mudur, kadir } = await sirket();

    // Temmuz'da yazılmış iki kayıt: biri Temmuz içinde onaylandı, biri
    // Temmuz bittikten **sonra**.
    const erken = await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    const gec = await createActivity(kadir, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: new Date("2026-07-16T09:00:00.000Z"),
    });

    await approveActivity(
      testDb,
      mudur.id,
      erken.id,
      new Date("2026-07-20T09:00:00.000Z"),
    );
    // Dönem bitti, işçi henüz koşmadı.
    await approveActivity(testDb, mudur.id, gec.id, DONEM_SONRASI);

    await closeScorePeriod(testDb, KAPANIS);

    const kabuller = await testDb.userScorePeriodFact.count({
      where: { userId: kadir.id, kind: "ACCEPTED" },
    });
    expect(kabuller, "yalnız dönem içinde onaylanan sayılmalı").toBe(1);
  });

  it("dönem bittikten sonra yapılan iptal kaydı düşürmez", async () => {
    const { mudur, kadir } = await sirket();
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await cancelActivity(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kayit.id,
      "Dönem bitince fark edildi.",
      DONEM_SONRASI,
    );

    await closeScorePeriod(testDb, KAPANIS);

    const yazilanlar = await testDb.userScorePeriodFact.count({
      where: { userId: kadir.id, kind: "WRITTEN" },
    });
    expect(yazilanlar, "kayıt Temmuz'da vardı; iptal Ağustos'ta").toBe(1);
  });

  it("dönem bittikten sonra iptal edilen izin paydaya geri dönmez", async () => {
    const { mudur, kadir } = await sirket();
    for (const gun of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    const izin = await testDb.noActivityPeriod.create({
      data: {
        userId: kadir.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-10T00:00:00.000Z"),
        markedById: kadir.id,
      },
    });

    // Temmuz'da izin geçerliydi; iptal Ağustos'ta yapıldı.
    await testDb.noActivityPeriod.update({
      where: { id: izin.id },
      data: {
        cancelledAt: DONEM_SONRASI,
        cancelledById: kadir.id,
        cancellationReason: "Yanlış girilmiş.",
      },
    });

    await closeScorePeriod(testDb, KAPANIS);

    const satir = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kadir.id },
    });
    // Temmuz 2026'da 23 iş günü var; 1-10 Temmuz sekiz iş gününü düşürüyor.
    expect(satir.expectedDays, "izin dönem içinde geçerliydi").toBe(15);
    void mudur;
  });
});

// Kapanış **durum geçişli** (denetim 25.08.2026, P8-R2-1).
//
// Katkı satırı tek tek değişmezdi ama kümeye sonradan satır **eklenebiliyordu**:
// kapanıştan günler sonra doğrudan bir `WRITTEN` satırı yazmak tarihsel karneyi
// değiştiriyordu. Değişmez olması gereken şey kümenin kendisi.
describe("kapanmış dönemin katkı kümesi kapalı", () => {
  it("kapanıştan sonra katkı eklenemez", async () => {
    const { kadir } = await sirket();
    const kayit = await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, KAPANIS);

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: kadir.id,
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          activityId: kayit.id,
          kind: "WRITTEN",
          happenedOn: new Date("2026-07-20T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_FROZEN/);
  });

  it("gerçek kapanış hâlâ çalışıyor ve katkıları yazıyor", async () => {
    const { kadir } = await sirket();
    for (const gun of ["2026-07-15", "2026-07-16"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
      });
    }

    const sonuc = await closeScorePeriod(testDb, KAPANIS);
    expect(sonuc.written).toBeGreaterThan(0);

    const satir = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kadir.id },
    });
    expect(satir.frozen, "kapanış mühürü indirmeli").toBe(true);
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: kadir.id } }),
    ).toBeGreaterThan(0);
  });
});
