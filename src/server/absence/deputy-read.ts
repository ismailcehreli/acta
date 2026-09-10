import type { Prisma, PrismaClient } from "@prisma/client";

import {
  COMPANY_TIME_ZONE,
  companyDay,
  toDateValue,
} from "@/server/activities/date-rules";

import {
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";

import { GECERLI_DONEM } from "./period-filter";

// Vekâlet ekranının okuma yolu (§4.5).
//
// İki soruya cevap verir ve ikisi de aynı veriden çıkar:
//
//   · **Vekile:** "hangi dönemlerde kimin yerine baktım, o dönemlerde ne
//     karar verdim?"
//   · **Dönen yöneticiye:** "yokluğumda ne oldu?"
//
// Kararlar denetim izinden okunuyor, faaliyet tablosundan değil. Sebep:
// iz **kimin adına** karar verildiğini de taşıyor (`actualUserId`) ve
// değişmez. Faaliyet tablosu yalnız son hâli gösterir; aynı kayıt sonradan
// düzeltilip yeniden karara bağlanmış olabilir.

export type DeputyReadDb = Pick<
  PrismaClient,
  "noActivityPeriod" | "auditLog"
> & ActivityRepositoryDb;

export interface DeputyPeriod {
  id: string;
  /** Yerine bakılan kişi. */
  personId: string;
  personName: string;
  personUnitName: string;
  startDate: Date;
  endDate: Date;
  note: string | null;
  /** Bugün bu dönem sürüyor mu? */
  active: boolean;
  /** Bu dönemde vekâletle verilen karar sayısı. */
  decisionCount: number;
}

export interface DeputyDecision {
  activityId: string;
  activityNo: number;
  activityTitle: string;
  authorName: string;
  action: string;
  at: Date;
  /** Kararı veren (vekil). */
  actorName: string;
  /** Adına karar verilen (izindeki yönetici). */
  onBehalfOfName: string | null;
}

/** Onay kararı sayılan iz işlemleri. */
const KARAR_ISLEMLERI = [
  "activity_approved",
  "activity_changes_requested",
  "activity_rejected",
];

/**
 * Vekâlet listesinin daraltması (Görev 11.4).
 *
 * Uzun süre vekâlet etmiş bir yönetici için liste birikiyor; "kimin yerine
 * baktım" sorusu kişi seçilerek cevaplanabilmeli.
 */
export interface DeputyPeriodFilters {
  /** Yerine bakılan kişi. */
  personId?: string;
}

/** Kapsam ve süzgeç koşulları; ezilemeyecek biçimde ayrı satırlar. */
function deputyPeriodWhere(
  deputyId: string,
  filters: DeputyPeriodFilters,
): Prisma.NoActivityPeriodWhereInput[] {
  const kosullar: Prisma.NoActivityPeriodWhereInput[] = [
    { deputyId },
    GECERLI_DONEM,
  ];

  if (filters.personId) kosullar.push({ userId: filters.personId });

  return kosullar;
}

/** Bu kişinin vekâlet ettiği dönemler; en yenisi üstte. */
export async function listDeputyPeriods(
  db: DeputyReadDb,
  deputyId: string,
  now: Date = new Date(),
  filters: DeputyPeriodFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<DeputyPeriod[]> {
  const bugun = toDateValue(companyDay(now));

  const satirlar = await db.noActivityPeriod.findMany({
    // Koşullar **`AND` ile** birleşiyor, nesne yaymayla değil: Prisma'da aynı
    // alan iki kez verilince sonuncusu kazanır ve bir süzgeç kapsam koşulunu
    // sessizce ezebilir. Aynı hata ekip izin listesinde gerçekten oluştu
    // (Görev 11.4, sızıntı testiyle bulundu).
    where: { AND: deputyPeriodWhere(deputyId, filters) },
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      note: true,
      user: { select: { fullName: true, orgUnit: { select: { name: true } } } },
    },
  });

  return Promise.all(
    satirlar.map(async (satir) => ({
      id: satir.id,
      personId: satir.userId,
      personName: satir.user.fullName,
      personUnitName: satir.user.orgUnit.name,
      startDate: satir.startDate,
      endDate: satir.endDate,
      note: satir.note,
      active: satir.startDate <= bugun && satir.endDate >= bugun,
      decisionCount: await db.auditLog.count({
        where: {
          userId: deputyId,
          actualUserId: satir.userId,
          action: { in: KARAR_ISLEMLERI },
          createdAt: donemAraligi(satir.startDate, satir.endDate),
        },
      }),
    })),
  );
}

/**
 * Bir vekâlet döneminde verilen kararlar.
 *
 * Hem vekil kendi geçmişine bakarken hem dönen yönetici "yokluğumda ne oldu"
 * derken aynı listeyi okur; ikisine ayrı sorgu yazmak, birinin diğerinden
 * ayrışması demekti.
 */
/** Süzgeçli toplam; sayfa sayısı buradan çıkar. */
export async function countDeputyPeriods(
  db: DeputyReadDb,
  deputyId: string,
  filters: DeputyPeriodFilters = {},
): Promise<number> {
  return db.noActivityPeriod.count({
    where: { AND: deputyPeriodWhere(deputyId, filters) },
  });
}

export async function listDeputyDecisions(
  db: DeputyReadDb,
  period: { personId: string; deputyId: string; startDate: Date; endDate: Date },
  /** Listeyi okuyan kişi; başlıklar onun kapsamıyla süzülür. */
  viewerId: string,
  now: Date = new Date(),
): Promise<DeputyDecision[]> {
  const izler = await db.auditLog.findMany({
    where: {
      userId: period.deputyId,
      actualUserId: period.personId,
      action: { in: KARAR_ISLEMLERI },
      createdAt: donemAraligi(period.startDate, period.endDate),
    },
    orderBy: { createdAt: "desc" },
    select: {
      objectId: true,
      action: true,
      createdAt: true,
      user: { select: { fullName: true } },
      actualUser: { select: { fullName: true } },
    },
  });

  if (izler.length === 0) return [];

  // Kayıt başlıkları tek sorguda; iz başına ayrı sorgu, uzun dönemde
  // yüzlerce tur demekti.
  //
  // **Kapsamdan geçer** (§8). Denetim izi kaydın kimliğini taşıyor ama
  // başlığını taşımıyor — başlık buradan geliyor ve başlık içeriktir.
  // Süzgeçsiz okumak, denetim izini görünürlük katmanını atlayan bir yola
  // çevirirdi (21.08.2026, okuma yolu envanteri).
  //
  // Pratikte hiçbir satır düşmez: vekilin kararını verdiği kayıt ona görünür
  // kalır (§8.2). Süzgeç, o kuralın buradan da geçtiğinin garantisidir.
  const kayitlar = await listVisibleActivities(db, {
    id: viewerId,
    isSystemAdmin: false,
  }, {
    where: { id: { in: [...new Set(izler.map((iz) => iz.objectId))] } },
    select: {
      id: true,
      activityNo: true,
      title: true,
      author: { select: { fullName: true } },
    },
  }, undefined, now);

  const kayitHaritasi = new Map(kayitlar.map((kayit) => [kayit.id, kayit]));

  return izler.flatMap((iz) => {
    const kayit = kayitHaritasi.get(iz.objectId);
    // Kayıt bulunamıyorsa satır **atlanmaz** demek istemezdik ama başlıksız
    // bir satır da bilgi taşımaz; izin kendisi denetim ekranında duruyor.
    if (!kayit) return [];

    return [
      {
        activityId: kayit.id,
        activityNo: kayit.activityNo,
        activityTitle: kayit.title,
        authorName: kayit.author.fullName,
        action: iz.action,
        at: iz.createdAt,
        actorName: iz.user?.fullName ?? "bilinmeyen kullanıcı",
        onBehalfOfName: iz.actualUser?.fullName ?? null,
      },
    ];
  });
}

/** Bu kişinin yokluğunda vekilinin verdiği kararlar (dönüş özeti). */
export async function listCoveredPeriods(
  db: DeputyReadDb,
  userId: string,
): Promise<DeputyPeriod[]> {
  const satirlar = await db.noActivityPeriod.findMany({
    where: { userId, deputyId: { not: null }, ...GECERLI_DONEM },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      deputyId: true,
      startDate: true,
      endDate: true,
      note: true,
      deputy: { select: { fullName: true, orgUnit: { select: { name: true } } } },
    },
  });

  return Promise.all(
    satirlar.map(async (satir) => ({
      id: satir.id,
      // Bu listede "kişi" vekildir: dönen yönetici kimin baktığını görür.
      personId: satir.deputyId ?? "",
      personName: satir.deputy?.fullName ?? "—",
      personUnitName: satir.deputy?.orgUnit.name ?? "—",
      startDate: satir.startDate,
      endDate: satir.endDate,
      note: satir.note,
      active: false,
      decisionCount: await db.auditLog.count({
        where: {
          userId: satir.deputyId ?? "",
          actualUserId: userId,
          action: { in: KARAR_ISLEMLERI },
          createdAt: donemAraligi(satir.startDate, satir.endDate),
        },
      }),
    })),
  );
}

/**
 * Dönemin **şirket saatiyle** kapsadığı zaman aralığı.
 *
 * `startDate` ve `endDate` birer *gün* değeridir ve veritabanında UTC gece
 * yarısı olarak durur. Karar anları (`AuditLog.createdAt`) ise gerçek
 * zamanlardır. İkisini doğrudan karşılaştırmak, İstanbul günü UTC'den üç saat
 * ileride olduğu için pencereyi kaydırıyordu (denetim 21.08.2026,
 * bulgu 12):
 *
 *   · İstanbul'da 21 Ağustos 00:30'da verilen karar (UTC 20 Ağustos 21:30)
 *     21 Ağustos döneminin **dışında** kalıyordu.
 *   · İstanbul'da 22 Ağustos 02:00'de verilen karar (UTC 21 Ağustos 23:00)
 *     21 Ağustos dönemine **giriyordu**.
 *
 * Doğrusu: aralık, İstanbul gün başlangıcından ertesi günün başlangıcına
 * kadar; başlangıç dâhil, bitiş hariç (§16.5 — bütün tarih yorumları
 * Europe/Istanbul).
 */
function donemAraligi(startDate: Date, endDate: Date): { gte: Date; lt: Date } {
  return {
    gte: sirketGunBasi(startDate),
    lt: sirketGunBasi(ertesiGun(endDate)),
  };
}

/** `YYYY-MM-DD` gün değerinin İstanbul'daki başlangıç anı (UTC olarak). */
function sirketGunBasi(day: Date): Date {
  const gun = day.toISOString().slice(0, 10);

  // Ofset yaz/kış saatine göre değişebilir; sabit "-03:00" yazmak yerine
  // gerçek ofset ölçülür.
  const varsayilan = new Date(`${gun}T00:00:00.000Z`);
  const ofsetDk = istanbulOfsetDakika(varsayilan);

  return new Date(varsayilan.getTime() - ofsetDk * 60_000);
}

function ertesiGun(day: Date): Date {
  const sonraki = new Date(day);
  sonraki.setUTCDate(sonraki.getUTCDate() + 1);
  return sonraki;
}

/**
 * Verilen anda Europe/Istanbul'un UTC'ye göre ofseti (dakika).
 *
 * Uygulamadaki tek `Intl.DateTimeFormat` kullanımı burada, `date-time.ts`
 * dışında: bu bir **biçimlendirme değil**, `formatToParts` ile yapılan bir
 * ofset ölçümü. Metin üretmiyor, sayı üretiyor; biçim modülüne taşınsaydı
 * modülün sözleşmesi ("gün alanı UTC, an alanı şirket saati") burada
 * anlamsız kalırdı (Görev 11.1).
 */
function istanbulOfsetDakika(instant: Date): number {
  const biciml = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parcalar = Object.fromEntries(
    biciml.formatToParts(instant).map((parca) => [parca.type, parca.value]),
  );

  const yerel = Date.UTC(
    Number(parcalar.year),
    Number(parcalar.month) - 1,
    Number(parcalar.day),
    Number(parcalar.hour === "24" ? "0" : parcalar.hour),
    Number(parcalar.minute),
    Number(parcalar.second),
  );

  return (yerel - instant.getTime()) / 60_000;
}
