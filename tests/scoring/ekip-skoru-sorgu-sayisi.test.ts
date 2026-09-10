import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readTeamScores, readScoreTrends } from "@/server/scoring/read";
import { SETTING_KEYS } from "@/server/settings/registry";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Ekip skorunun **sorgu bütçesi** (denetim 23.08.2026, bulgu 9).
//
// Tasarım 40 kişilik ekipte kişi başına ayrı çok tablolu canlı hesap
// yapılmasını açıkça yasaklıyor. Kod kişileri sırayla dolaşıp her biri için
// `readUserScore`, sonra ayrıca `readScoreTrend` çağırıyor; her hesap takvim,
// izin, faaliyet, karar ve takip sorguları koşturuyor.
//
// Süre ölçmek burada yeterli değil: hızlı bir makinede yavaşlık görünmez ve
// ölçüm makineden makineye değişir. Sorgu **sayısı** ise koddan gelir ve
// kişi sayısıyla birlikte büyüyorsa bunu doğrudan gösterir.

const KISI = 40;
const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Sorguları sayan ayrı istemci; `testDb` günlük tutmuyor. */
function sayanIstemci() {
  const client = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
    log: [{ emit: "event", level: "query" }],
  });

  let sayac = 0;
  (client as unknown as {
    $on: (olay: "query", dinleyici: () => void) => void;
  }).$on("query", () => {
    sayac += 1;
  });

  return {
    client,
    sifirla: () => {
      sayac = 0;
    },
    oku: () => sayac,
  };
}

/**
 * Modele göre **çekilen satır** sayan istemci.
 *
 * Sorgu sayısı düzleşse de taşınan satır tarihçeyle büyüyebilir; süre ve
 * bellek onunla artar. Uzantı sonucun uzunluğunu okuyor, yani ölçülen şey
 * gerçekten ağdan gelen satır.
 */
function satirSayanIstemci() {
  const sayaclar: Record<string, number> = {};

  const client = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  }).$extends({
    query: {
      // Ham sorgular (`$queryRaw`) modelsiz gelir; onlar da sayılmalı çünkü
      // dönem penceresi ham SQL ile okunuyor.
      async $allOperations({ model, args, query }) {
        const sonuc = await query(args);
        if (Array.isArray(sonuc)) {
          const anahtar = model ?? "ham";
          sayaclar[anahtar] = (sayaclar[anahtar] ?? 0) + sonuc.length;
        }
        return sonuc;
      },
    },
  });

  return {
    client,
    sifirla: () => {
      for (const anahtar of Object.keys(sayaclar)) delete sayaclar[anahtar];
    },
    oku: () => ({ ...sayaclar }),
  };
}

async function ekipKur(kisiSayisi: number) {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const mudur = await createUser(kok.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });

  for (let i = 0; i < kisiSayisi; i += 1) {
    const kisi = await createUser(birim.id, { fullName: `Çalışan ${i + 1}` });
    // Her kişinin dönemde birkaç kaydı olsun; boş ekip hesabı ölçmez.
    for (const gun of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
      await createActivity(kisi, { activityDate: new Date(`${gun}T00:00:00.000Z`) });
    }
    // Geçmiş dönem: trend okuması gerçekten satır bulsun.
    await testDb.userScorePeriod.create({
      data: {
        userId: kisi.id,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        regularity: 70,
        followUp: 100,
        total: 78,
        expectedDays: 22,
        writtenDays: 15,
        // Dondurulmuş dönem: eski model satırları hiçbir ekranda okunmuyor,
        // dolayısıyla okunmayan satırla ölçüm yapmak yanıltıcı olurdu.
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

  await testDb.systemSetting.create({
    data: {
      key: SETTING_KEYS.scoringEnabled,
      value: "true",
      description: "Skor sistemi",
    },
  });

  return { mudur };
}

describe("trend okuması tarihçeyle büyümez", () => {
  // Sorgu **sayısı** düzleşse de taşınan **satır** sayısı yıllarla doğrusal
  // büyüyordu (denetim 25.08.2026, P8-8): dönem sorgusunda kişi başına
  // sıra sınırı yoktu, olgu sorgusu ise kesilmiş dönem anahtarlarını bile
  // kullanmadan bütün geçmişi getiriyordu. Ekranın ve düşüş hesabının
  // ihtiyacı yalnız en yeni `max(6, eşik)` dönem.
  async function donemliKisi(donemSayisi: number) {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(kok.id, {
      fullName: "Genel Müdür",
      isUnitManager: true,
    });
    const kisi = await createUser(birim.id, { fullName: "Çalışan" });

    for (let i = 0; i < donemSayisi; i += 1) {
      const donemBasi = new Date(Date.UTC(2021, i, 1));
      // Gerçek kapanışın sırası: taslak aç, katkıları yaz, mühürle
      // (denetim 25.08.2026, P8-R2-1).
      await testDb.userScorePeriod.create({
        data: {
          userId: kisi.id,
          periodStart: donemBasi,
          regularity: 40,
          followUp: 30,
          total: 70,
          expectedDays: 22,
          writtenDays: 20,
          frozen: false,
        },
      });

      // Dönem başına gerçekçi katkı hacmi.
      const kayit = await createActivity(kisi, { activityDate: donemBasi });
      await testDb.userScorePeriodFact.createMany({
        data: Array.from({ length: 20 }, () => ({
          userId: kisi.id,
          periodStart: donemBasi,
          activityId: kayit.id,
          kind: "WRITTEN" as const,
          happenedOn: donemBasi,
        })),
      });

      await testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: kisi.id,
            periodStart: donemBasi,
            revisionNo: 1,
          },
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
    }

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.scoringEnabled,
        value: "true",
        description: "Skor sistemi",
      },
    });

    return { mudur, kisi };
  }

  /** Verilen aralıkta donmuş dönemleri ve dönem başına on katkısı olan kişi. */
  async function kisiVeDonemler(
    birimId: string,
    ad: string,
    ilkAy: number,
    donemSayisi: number,
  ) {
    const kisi = await createUser(birimId, { fullName: ad });

    for (let i = 0; i < donemSayisi; i += 1) {
      const donemBasi = new Date(Date.UTC(2021, ilkAy + i, 1));
      await testDb.userScorePeriod.create({
        data: {
          userId: kisi.id,
          periodStart: donemBasi,
          regularity: 40,
          followUp: 30,
          total: 70,
          expectedDays: 22,
          writtenDays: 20,
          frozen: false,
        },
      });

      const kayit = await createActivity(kisi, { activityDate: donemBasi });
      await testDb.userScorePeriodFact.createMany({
        data: Array.from({ length: 10 }, () => ({
          userId: kisi.id,
          periodStart: donemBasi,
          activityId: kayit.id,
          kind: "WRITTEN" as const,
          happenedOn: donemBasi,
        })),
      });

      await testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: kisi.id,
            periodStart: donemBasi,
            revisionNo: 1,
          },
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
    }

    return kisi;
  }

  it("altmış dönemlik tarihçede de yalnız gereken dönemler okunur", async () => {
    const sayim = sayanIstemci();

    try {
      const olc = async (donemSayisi: number) => {
        await resetDatabase();
        const { mudur, kisi } = await donemliKisi(donemSayisi);

        const trendler = await readScoreTrends(
          sayim.client,
          { id: mudur.id, isSystemAdmin: false },
          [kisi.id],
        );
        return trendler.get(kisi.id)?.periods.length ?? 0;
      };

      // Bir dönemlik tarihçede ekran bir dönem gösterir.
      expect(await olc(1)).toBe(1);
      // Altmış dönemlik tarihçede de en fazla altı: grafik altı dönem çiziyor.
      expect(await olc(60)).toBe(6);

    } finally {
      await sayim.client.$disconnect();
    }
  });

  it("asimetrik tarihçede yalnız seçilen kişi-dönem çiftleri çekilir", async () => {
    // İki kullanıcı, **farklı uzunlukta** tarihçe (denetim 25.08.2026,
    // P8-R2-5). Fact sorgusu seçilen bileşik `(userId, periodStart)`
    // anahtarlarını değil, tarihlerin **birleşimini** kullanıyordu: uzun
    // tarihçeli kişinin ekrandan kesilmiş eski dönemleri, kısa kişinin
    // seçilen tarihlerine denk geldiği için yeniden sorguya giriyordu.
    const sayim = satirSayanIstemci();

    try {
      await resetDatabase();
      const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
      const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
      const mudur = await createUser(kok.id, {
        fullName: "Genel Müdür",
        isUnitManager: true,
      });

      // Uzun tarihçe: 2021'in on iki ayı. Kısa tarihçe: aynı yılın
      // **ilk** altı ayı — yani uzun kişinin kesilen dönemleriyle çakışıyor.
      const uzun = await kisiVeDonemler(birim.id, "Uzun", 0, 12);
      const kisa = await kisiVeDonemler(birim.id, "Kısa", 0, 6);

      await testDb.systemSetting.create({
        data: {
          key: SETTING_KEYS.scoringEnabled,
          value: "true",
          description: "Skor sistemi",
        },
      });

      sayim.sifirla();
      await readScoreTrends(
        sayim.client as unknown as Parameters<typeof readScoreTrends>[0],
        { id: mudur.id, isSystemAdmin: false },
        [uzun.id, kisa.id],
      );
      const cekilen = sayim.oku();
      console.log(`SATIR|asimetrik=${JSON.stringify(cekilen)}`);

      // İhtiyaç: uzun kişi 6 dönem, kısa kişi 6 dönem; dönem başına 10 olgu.
      expect(cekilen.UserScorePeriodFact, "çekilen katkı satırı").toBe(2 * 6 * 10);
    } finally {
      await sayim.client.$disconnect();
    }
  });

  it("çekilen satır sayısı tarihçeyle büyümüyor", async () => {
    const sayim = satirSayanIstemci();

    try {
      const olc = async (donemSayisi: number) => {
        await resetDatabase();
        const { mudur, kisi } = await donemliKisi(donemSayisi);
        sayim.sifirla();

        await readScoreTrends(
          // Uzantılı istemcinin tipi taban istemciyle birebir aynı değil;
          // çalışma zamanında aynı nesne.
          sayim.client as unknown as Parameters<typeof readScoreTrends>[0],
          { id: mudur.id, isSystemAdmin: false },
          [kisi.id],
        );

        return sayim.oku();
      };

      const az = await olc(1);
      const cok = await olc(60);

      console.log(
        `SATIR|1 dönem=${JSON.stringify(az)} · 60 dönem=${JSON.stringify(cok)}`,
      );

      // Ekranın ihtiyacı yalnız en yeni altı dönem ve onların katkıları.
      // Altmış dönemlik tarihçede 60 dönem + 1200 olgu çekmek, sorgu sayısı
      // sabit olsa bile belleği ve ağı tarihçeyle büyütürdü.
      // Dönem penceresi ham SQL ile okunuyor; `ham` kovası kapsam sorgusunun
      // birkaç satırını da içeriyor, o yüzden **büyüme** ölçülüyor: tarihçe
      // 60 katına çıkarken taşınan dönem satırı yalnız 1'den 6'ya çıkmalı.
      expect((cok.ham ?? 0) - (az.ham ?? 0), "çekilen dönem satırı artışı")
        .toBeLessThanOrEqual(5);

      // Katkılar da yalnız okunan dönemlerden geliyor: 60 × 20 değil, 6 × 20.
      expect(cok.UserScorePeriodFact, "çekilen katkı satırı").toBeLessThanOrEqual(
        6 * 20,
      );
    } finally {
      await sayim.client.$disconnect();
    }
  });
});

describe("ekip skoru sorgu bütçesi", () => {
  it("kişi sayısı ikiye katlandığında sorgu sayısı katlanmıyor", async () => {
    const sayim = sayanIstemci();

    try {
      const olc = async (kisiSayisi: number) => {
        await resetDatabase();
        const { mudur } = await ekipKur(kisiSayisi);
        const viewer = { id: mudur.id, isSystemAdmin: false };

        // Isınma: bağlantı kurulum sorguları sayıma girmesin.
        await sayim.client.user.count();
        sayim.sifirla();

        // `/scores` sayfasının yaptığının aynısı: önce ekip skorları, sonra
        // düşüş işareti için trendler.
        const skorlar = await readTeamScores(sayim.client, viewer, NOW);
        await readScoreTrends(
          sayim.client,
          viewer,
          skorlar.map((s) => s.userId),
        );

        return { kisi: skorlar.length, sorgu: sayim.oku() };
      };

      const az = await olc(KISI / 2);
      const cok = await olc(KISI);

      expect(az.kisi).toBe(KISI / 2);
      expect(cok.kisi).toBe(KISI);

      // Ölçülen sayı raporlanır: taban da, düzeltme sonrası da görünür olsun.
      console.log(
        `SORGU|${az.kisi} kişi=${az.sorgu} · ${cok.kisi} kişi=${cok.sorgu}`,
      );

      // **Sabit bir tavan değil, büyüme oranı** sınanıyor: makineden ve
      // Prisma sürümünden bağımsız olan şey, kişi sayısı ikiye katlanınca
      // sorgu sayısının katlanmaması.
      expect(
        cok.sorgu,
        `${az.kisi} kişide ${az.sorgu}, ${cok.kisi} kişide ${cok.sorgu} sorgu — ` +
          "kişi başına hesap yapılıyor",
      ).toBeLessThan(az.sorgu * 1.5);
    } finally {
      await sayim.client.$disconnect();
    }
  });
});
