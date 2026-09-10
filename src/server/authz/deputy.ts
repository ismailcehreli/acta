import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { GECERLI_DONEM } from "@/server/absence/period-filter";

// VEKÂLET (§4.5, ürün sahibi kararı 21.08.2026).
//
// Vekâlet, izin işaretinin (`NoActivityPeriod`) üzerine biner: bir yönetici
// için tarih aralığı girilirken vekil seçilebilir. Ayrı bir tablo açılmadı,
// çünkü vekâletin başlangıcı ve bitişi zaten o aralık — ayrı tutulsaydı iki
// tarih aralığını senkron tutmak gerekirdi ve biri unutulurdu.
//
// **Vekâlet ekler, çıkarmaz.** İzindeki yöneticinin yetkisi alınmaz; girerse
// her şeyi görmeye devam eder. Vekil, onun kapsamını **ek olarak** kazanır.
//
// **Yalnız yönetici düzeyinde.** Hem izne çıkan hem vekil birim yöneticisi
// olmalı; doğrulama `markNoActivityPeriod` içinde.
//
// Vekâletin iki yüzü var ve ikisi ayrı kurallarla işler:
//
//   1. **Süre içinde** — vekil, vekâlet ettiği birimin **o döneme ait**
//      kayıtlarını görür ve o kişinin onayına düşmüş işleri karara bağlar.
//   2. **Süre bittikten sonra** — aynı dönemin kayıtlarını görmeye devam
//      eder. Sebep: aylar sonra o döneme dair bir soru gelirse cevap
//      verebilmeli (ürün sahibi kararı, 21.08.2026).
//
// **Dönem dışına çıkmaz.** Vekil, vekâlet ettiği birimin daha eski
// kayıtlarını hiçbir zaman görmez — bir haftalık izin, yılların arşivine
// kapı açmaz. Sınır tarihtir: kaydın faaliyet günü vekâlet aralığında mı,
// değil mi.
//
// Bir istisna var ve dar: **kararını verdiği kayıt** her hâlükârda görünür
// kalır. Vekâlet başlamadan önce yazılmış ama devralınan kuyrukta bekleyen
// bir kayıt olabilir; onu onaylayan kişi, kararının arkasında durabilmeli.

export type DeputyDb = Pick<PrismaClient, "noActivityPeriod">;

export interface DeputyPeriodRange {
  /** Vekâlet edilen kişi. */
  personId: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Bu kişinin **bütün** vekâlet dönemleri — geçmiş dahil.
 *
 * Görünürlük bunlara bakıyor: her dönem, o dönemin tarih aralığıyla sınırlı
 * bir pencere açar ve pencere süresiz kalır (aylar sonra gelen soruya cevap
 * verebilmek için).
 */
export async function allDeputyPeriods(
  db: DeputyDb,
  deputyId: string,
): Promise<DeputyPeriodRange[]> {
  const satirlar = await db.noActivityPeriod.findMany({
    where: { deputyId, ...GECERLI_DONEM },
    select: { userId: true, startDate: true, endDate: true },
  });

  return satirlar.map((satir) => ({
    personId: satir.userId,
    startDate: satir.startDate,
    endDate: satir.endDate,
  }));
}

/**
 * Bu kişi **şu an** kimlerin yerine bakıyor?
 *
 * Dönen kimlikler, vekâlet edilen kişilerin kimlikleridir. Boş dizi "vekâleti
 * yok" demektir ve çağıranlar bunu ek sorgu açmadan geçebilir.
 */
export async function activeDeputyFor(
  db: DeputyDb,
  deputyId: string,
  now: Date,
): Promise<string[]> {
  const bugun = toDateValue(companyDay(now));

  const satirlar = await db.noActivityPeriod.findMany({
    where: {
      deputyId,
      ...GECERLI_DONEM,
      startDate: { lte: bugun },
      endDate: { gte: bugun },
    },
    select: { userId: true },
  });

  return [...new Set(satirlar.map((satir) => satir.userId))];
}

/**
 * Birden çok kişinin vekillerini tek sorguda çözer.
 *
 * Onay listesi yazılırken her yönetici için ayrı sorgu açmamak için;
 * iki müdürlü bir birimde bu iki tur demek olurdu.
 */
export async function activeDeputiesOfMany(
  db: DeputyDb,
  userIds: string[],
  now: Date,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const bugun = toDateValue(companyDay(now));

  const satirlar = await db.noActivityPeriod.findMany({
    where: {
      userId: { in: userIds },
      deputyId: { not: null },
      ...GECERLI_DONEM,
      startDate: { lte: bugun },
      endDate: { gte: bugun },
    },
    select: { deputyId: true },
  });

  return [
    ...new Set(
      satirlar
        .map((satir) => satir.deputyId)
        .filter((id): id is string => id !== null),
    ),
  ];
}
