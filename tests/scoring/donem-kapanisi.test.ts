import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Dönem kapanışı ve trend (Görev 11.11).
//
// Skorun en değerli kullanımı **sıralamak değil, düşüşü yakalamaktır**:
// "Ahmet 7. sırada" bir şey söylemez, "üç dönemdir düşüyor" söyler. Trend
// için geçmiş dönemlerin saklanması gerekiyor — canlı hesap yalnız içinde
// bulunulan dönemi bilir.

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
  const mudur = await createUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  return { kadir, mudur };
}

/**
 * Verilen ayın kapanışının **gerçekten koştuğu** an.
 *
 * Ayın ilk günü değil üçüncü günü: kapanış, geriye giriş penceresi kapanmadan
 * dönemi dondurmuyor (denetim 25.08.2026, P8-R2-2). Varsayılan ayarla
 * bir önceki ayın son gününe ait kayıt ayın 1'inde hâlâ girilebiliyor.
 */
function kapanisAni(yil: number, ay: number): Date {
  return new Date(Date.UTC(yil, ay - 1, 3, 6, 0, 0));
}

describe("dönem kapanışı", () => {
  it("kapanan dönemin skorunu tabloya yazar", async () => {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    // 1 Ağustos'ta koşar, **Temmuz'u** kapatır.
    // Kurulumda iki kişi var (müdür ve çalışan); ikisi de puanlanıyor.
    const sonuc = await closeScorePeriod(testDb, kapanisAni(2026, 8));

    expect(sonuc.written).toBe(2);
    const kayit = await testDb.userScorePeriod.findFirst({
      where: { userId: kadir.id },
    });
    expect(kayit?.periodStart.toISOString().slice(0, 10)).toBe("2026-07-01");
    // Pay ve payda da saklanıyor: altı ay sonra "neden bu puan" sorulabilmeli.
    expect(kayit?.writtenDays).toBe(1);
    expect(kayit?.expectedDays).toBeGreaterThan(0);
  });

  it("aynı dönem iki kez yazılmaz", async () => {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, kapanisAni(2026, 8));
    const ikinci = await closeScorePeriod(testDb, kapanisAni(2026, 8));

    expect(ikinci.written).toBe(0);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: kadir.id } }),
    ).toBe(1);
  });

  it("skor kapalıyken hiç yazmaz", async () => {
    await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "false" });

    const sonuc = await closeScorePeriod(testDb, kapanisAni(2026, 8));

    expect(sonuc.written).toBe(0);
  });

  it("puanlanmayan kişi için yazmaz", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    // Kişi dönemden sonra puan dışına alınmış değil, baştan beri
    // puanlanmıyor. Etkili-tarih hesabında bu ayrım üretim davranışıdır.
    const kadir = await createUser(birim.id, {
      fullName: "Kadir Usta",
      isScored: false,
    });

    await closeScorePeriod(testDb, kapanisAni(2026, 8));

    expect(
      await testDb.userScorePeriod.count({ where: { userId: kadir.id } }),
    ).toBe(0);
  });
});

describe("trend ve düşüş işareti", () => {
  // Bu bölüm **kişinin kendi** trendini okuyor: ham dönem satırı yalnız ona
  // doğrudan verilir. Başka bakanın gördüğü sayı bir alttaki bölümde.

  async function donemYaz(userId: string, gun: string, toplam: number) {
    await testDb.userScorePeriod.create({
      data: {
        userId,
        periodStart: new Date(`${gun}T00:00:00.000Z`),
        regularity: toplam,
        followUp: 0,
        total: toplam,
        expectedDays: 20,
        writtenDays: Math.round((toplam / 100) * 20),
        // **Dondurulmuş dönem** (P3-R2-4). Katkı taşımayan eski model
        // satırları hiçbir ekranda okunmuyor; kurulum da kapanış işçisinin
        // ürettiğiyle aynı şekli kurmalı, yoksa test üretimde olmayan bir
        // satırı sınardı.
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });
  }

  it("son dönemleri yeniden eskiye verir", async () => {
    const { kadir } = await sirket();
    await donemYaz(kadir.id, "2026-05-01", 90);
    await donemYaz(kadir.id, "2026-06-01", 78);
    await donemYaz(kadir.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.periods.map((p) => p.total)).toEqual([64, 78, 90]);
  });

  // Üç dönem üst üste düşüş: yöneticinin görmesi gereken asıl sinyal.
  //
  // **Eşik dönem sayısıdır, geçiş sayısı değil** (denetim 23.08.2026,
  // bulgu 7). Üç dönemlik `90 → 78 → 64` dizisinde iki geçiş vardır ve
  // tasarımın örneği tam olarak budur; işaret dördüncü dönemi beklemez.
  it("üç dönemlik düşüş dizisi işaretlenir", async () => {
    const { kadir } = await sirket();
    await donemYaz(kadir.id, "2026-05-01", 90);
    await donemYaz(kadir.id, "2026-06-01", 78);
    await donemYaz(kadir.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.declining).toBe(true);
  });

  // İki dönem yetmez: eşik üç dönem.
  it("iki dönem düşüşte işaretlenmez", async () => {
    const { kadir } = await sirket();
    await donemYaz(kadir.id, "2026-05-01", 90);
    await donemYaz(kadir.id, "2026-06-01", 78);

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.declining).toBe(false);
  });

  it("arada yükselme varsa işaretlenmez", async () => {
    const { kadir } = await sirket();
    await donemYaz(kadir.id, "2026-04-01", 95);
    await donemYaz(kadir.id, "2026-05-01", 70);
    await donemYaz(kadir.id, "2026-06-01", 85);
    await donemYaz(kadir.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.declining).toBe(false);
  });

  // **Eşik 6'dan büyük seçilebiliyor ama alarm hiç yanmıyordu**
  // (denetim 23.08.2026, P3-5): trend sorgusu koşulsuz `take: 6` kullanıyordu,
  // yedi dönemlik eşik en az altı düşüş geçişi ister ve elde en fazla beş
  // geçiş bulunurdu. Panel kabul ettiği ayarı sessizce etkisiz kılıyordu.
  it("yedi dönemlik eşik yedi dönemlik düşüşle yanar", async () => {
    const { kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.scoringDeclinePeriods]: "7" });

    const toplamlar = [95, 90, 85, 80, 75, 70, 65];
    for (const [i, toplam] of toplamlar.entries()) {
      await donemYaz(kadir.id, `2026-0${i + 1}-01`, toplam);
    }

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.declining).toBe(true);
    // Grafik yine son altı dönemi gösteriyor; hesap daha derine bakıyor.
    expect(trend.periods).toHaveLength(6);
  });

  it("yedi dönemlik eşikte altı dönem yetmez", async () => {
    const { kadir } = await sirket();
    await saveSettings(testDb, { [SETTING_KEYS.scoringDeclinePeriods]: "7" });

    const toplamlar = [90, 85, 80, 75, 70, 65];
    for (const [i, toplam] of toplamlar.entries()) {
      await donemYaz(kadir.id, `2026-0${i + 1}-01`, toplam);
    }

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.declining).toBe(false);
  });

  // Trend de bir okuma yoludur: kapsam dışı kişinin geçmişi görünmez.
  it("kapsam dışı kişinin trendi boş döner", async () => {
    const { kadir } = await sirket();
    const planlama = await createOrgUnit({ name: "Planlama", type: "Kök" }).catch(
      async () => {
        const kokBirim = await testDb.orgUnit.findFirst({ where: { parentId: null } });
        return testDb.orgUnit.create({
          data: { name: "Planlama", type: "Birim", parentId: kokBirim!.id },
        });
      },
    );
    const yabanci = await createUser(planlama.id, { fullName: "Yabancı" });
    await donemYaz(kadir.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: yabanci.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.periods).toHaveLength(0);
    expect(trend.declining).toBe(false);
  });
});

describe("kapanmış dönem başkasının gözünden", () => {
  // **Ham dönem satırı kişinin kendi kapsamıyla hesaplanır** (FAZ 11 tasarımı,
  // satır 723-726): *"Bu tablo ham skoru tutar (kişinin kendi kapsamındaki).
  // Başkasının profiline bakan kişi için skor, o kişinin görünürlüğüyle
  // yeniden hesaplanır; tablodan doğrudan okunmaz."*
  //
  // Kod bunu ihlal ediyordu (denetim 23.08.2026, bulgu 2): satır
  // başka bakana **aynen** dönüyordu. Üst yönetici, hiç göremediği bekleyen
  // ya da reddedilmiş kayıtların etkisini toplam skordan okuyabiliyordu —
  // tasarımın adıyla yasakladığı toplamsal sızıntı.

  async function sirketVeKayitlar() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const kaliphane = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: true,
    });

    const gm = await createUser(kok.id, {
      fullName: "Genel Müdür",
      isUnitManager: true,
    });
    const mudur = await createUser(kaliphane.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
    const neset = await createUser(kaliphane.id, { fullName: "Neşet Usta" });

    // İki çalışanın **görünen** verisi birebir aynı: aynı günlerde üçer
    // onaylanmış kayıt.
    for (const kisi of [kadir, neset]) {
      for (const gun of ["2026-07-06", "2026-07-07", "2026-07-08"]) {
        await createActivity(kisi, {
          activityDate: new Date(`${gun}T00:00:00.000Z`),
          approvalStatus: "APPROVED",
          approverId: mudur.id,
          approvalSubmittedAt: new Date(`${gun}T08:00:00.000Z`),
          approvalDecidedAt: new Date(`${gun}T09:00:00.000Z`),
        });
      }
    }

    // Fark yalnız burada: Kadir'in onay bekleyen iki kaydı var. Bu kayıtları
    // **yalnız aktif onaylayıcı** görür; genel müdüre hiç akmaz (§8.2).
    for (const gun of ["2026-07-09", "2026-07-10"]) {
      await createActivity(kadir, {
        activityDate: new Date(`${gun}T00:00:00.000Z`),
        approvalStatus: "PENDING_APPROVAL",
        approverId: mudur.id,
        approvalSubmittedAt: new Date(`${gun}T08:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, kapanisAni(2026, 8));

    const hamSatir = async (userId: string) =>
      testDb.userScorePeriod.findUniqueOrThrow({
        where: {
          userId_periodStart_revisionNo: {
            userId,
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            revisionNo: 1,
          },
        },
      });

    return { gm, mudur, kadir, neset, hamSatir };
  }

  it("gizli kayıtlar ham skoru gerçekten değiştiriyor", async () => {
    // Bu testin işi kurulumu doğrulamak: aşağıdaki iki test ancak ham
    // satırlar farklıysa bir şey ölçüyor.
    const { kadir, neset, hamSatir } = await sirketVeKayitlar();

    const kadirHam = await hamSatir(kadir.id);
    const nesetHam = await hamSatir(neset.id);

    expect(kadirHam.total).not.toBe(nesetHam.total);
  });

  it("kişinin kendisi ham dönem satırını görür", async () => {
    const { kadir, hamSatir } = await sirketVeKayitlar();

    const trend = await readScoreTrend(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.periods[0]?.total).toBe((await hamSatir(kadir.id)).total);
  });

  it("aktif onaylayıcı bekleyen kaydı gördüğü için aynı sayıya varır", async () => {
    const { mudur, kadir, hamSatir } = await sirketVeKayitlar();

    const trend = await readScoreTrend(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      kadir.id,
    );

    // Yeniden hesaplama "gizle" demek değil: bakanın kapsamı kişinin
    // kapsamıyla örtüşüyorsa sayı da aynı çıkar.
    expect(trend.periods[0]?.total).toBe((await hamSatir(kadir.id)).total);
  });

  it("üst yönetici ham skoru değil kendi kapsamının skorunu görür", async () => {
    const { gm, kadir, hamSatir } = await sirketVeKayitlar();

    const trend = await readScoreTrend(
      testDb,
      { id: gm.id, isSystemAdmin: false },
      kadir.id,
    );

    expect(trend.periods[0]?.total).not.toBe((await hamSatir(kadir.id)).total);
  });

  it("görünmeyen kayıtlar üst yöneticinin gördüğü skoru hiç değiştirmez", async () => {
    // **Asıl sınav bu.** İki çalışanın görünen verisi birebir aynı, gizli
    // verisi farklı. Gizli kayıtlardan tek bir bit sızsa iki sayı ayrışırdı.
    const { gm, kadir, neset } = await sirketVeKayitlar();
    const bakan = { id: gm.id, isSystemAdmin: false };

    const kadirTrend = await readScoreTrend(testDb, bakan, kadir.id);
    const nesetTrend = await readScoreTrend(testDb, bakan, neset.id);

    expect(kadirTrend.periods[0]?.total).toBe(nesetTrend.periods[0]?.total);
    expect(kadirTrend.periods[0]?.total).toBeGreaterThan(0);
  });
});

// Kapanacak ay **şirket saatiyle** seçilir (denetim 25.08.2026, P8-3).
//
// `oncekiAy` `getUTCFullYear/getUTCMonth` kullanıyordu. İşçi her dakika gerçek
// `now` ile çağrılıyor ve Europe/Istanbul'da ayın 1'i 00:00–02:59 aralığı
// UTC'de hâlâ **önceki aydır**: 1 Ağustos 01:00 şirket saatinde koşan işçi
// Temmuz yerine Haziran'ı kapatmaya çalışıyordu. Yeni biten ay her ay üç saat
// geç kapanıyor ve o pencerede yanlış dönem yazılabiliyordu.
//
// Ana belge bütün tarih hesaplarında Europe/Istanbul'u zorunlu kılıyor (§16.6).
describe("kapanacak ay şirket saatiyle seçilir", () => {
  async function kapananDonem(now: Date): Promise<string | null> {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    // Geriye giriş penceresi **kapalı**: burada ölçülen şey hangi ayın
    // hedeflendiği, pencerenin ne zaman kapandığı değil (o ayrı bir test).
    // Dönem ayarı artık olay geçmişinden çözülür; sahte Temmuz kapanışı için
    // olayın da Temmuz sonunda yürürlükte olması gerekir.
    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "0",
        effectiveAt: new Date("2026-07-31T20:59:00.000Z"),
        reason: "TEST_PERIOD_END_SETTING",
      },
    });

    const sonuc = await closeScorePeriod(testDb, now);
    return sonuc.periodStart;
  }

  it("1 Ağustos 01:00 şirket saatinde Temmuz kapanır", async () => {
    // 2026-07-31T22:00:00Z = 1 Ağustos 01:00 Europe/Istanbul
    expect(await kapananDonem(new Date("2026-07-31T22:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("1 Ağustos 02:59 şirket saatinde de Temmuz kapanır", async () => {
    expect(await kapananDonem(new Date("2026-07-31T23:59:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("1 Ağustos 03:00 şirket saatinde Temmuz kapanır", async () => {
    expect(await kapananDonem(new Date("2026-08-01T00:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("31 Temmuz 23:00 şirket saatinde hâlâ Haziran kapanır", async () => {
    // Ay daha bitmedi: bir önceki ay Haziran'dır.
    expect(await kapananDonem(new Date("2026-07-31T20:00:00.000Z"))).toBe(
      "2026-06-01",
    );
  });
});
