import type { PrismaClient } from "@prisma/client";

import {
  subordinateUserIds,
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import {
  SETTING_KEYS,
  readBooleanSetting,
  readNumericSetting,
} from "@/server/settings/system-settings";
import { companyDay } from "@/shared/format/date-time";

import {
  collectScoreInput,
  collectScoreInputs,
  loadScoreContext,
  type ScoreCollectDb,
} from "./collect";
import {
  computeScore,
  profileWeights,
  resolveScoreProfile,
  SCORE_CALCULATORS,
  type ScoreInput,
  type ScoreProfile,
  type ScoreResult,
  type ScoreWeights,
} from "./compute";
import { readScoreWeights } from "./weights";

// Skorun okunması ve **görünürlüğü** (Görev 11.10).
//
// **Skor bir toplamdır ve toplam, görülmeyen kaydı ele verir.** Tasarım
// belgesi satır 1748'de bu ilke zaten yazılı: "aynı kişinin profilinde müdür
// 2 kayıt, genel müdür 1 kayıt sayar — sayaç, listede gizlenen kaydı sayıyla
// ele vermez."
//
// Bu yüzden:
//
//   · Skor **bakan kişinin kapsamına göre** okunuyor; kapsam dışı kişinin
//     skoru `null` dönüyor ("var ama göremezsin" demek kişinin varlığını ve
//     çalışma düzenini ele verirdi).
//   · **Genel sıralama yok.** Sıralama kapsam içidir.
//   · Sistem yöneticisi başkasının skorunu **göremez**: §15.1'e göre o yetki
//     işlevseldir ve içerik erişimi vermez; skor kişinin çalışma verisinden
//     türüyor ve içeriktir.
//   · Kapanmış dönemin **ham** satırı (`UserScorePeriod`) yalnız kişinin
//     kendisine doğrudan verilir; başka bakan için her dönem onun kapsamıyla
//     yeniden hesaplanır (bkz. `donemToplamlari`).
//
// Yeniden hesaplama **pahalıdır**: her dönem için takvim, izin, faaliyet,
// karar ve takip sorguları koşuyor ve ekip listesinde bu kişi başına
// tekrarlanıyor. Sorgu sayısı denetimin 9. bulgusunda ayrıca ele
// alınıyor (Paket 6); doğruluk orada da bu kuralın üstüne kurulmalı —
// önbellek kapsam anahtarlı olmadan yazılamaz.

export type ScoreReadDb = ScoreCollectDb &
  VisibilityDb &
  Pick<
    PrismaClient,
    "systemSetting" | "userScorePeriod" | "userScorePeriodFact" | "$queryRaw"
  >;

export interface UserScore extends ScoreResult {
  userId: string;
  periodStart: string;
  expectedDays: number;
  writtenDays: number;
  writtenCount: number;
  approvedCount: number;
  decidedCount: number;
  decidedOnTimeCount: number;
  followUpTotal: number;
  followUpHandled: number;
  profile: ScoreProfile;
  /** Bu kişinin profiline göre puan tavanları. */
  weights: ScoreWeights;
  /** Takdir katkısı eklenmeden önceki üç temel bölümün toplamı. */
  baseTotal: number;
  /** Bu dönemde skora katkı sağlayan takdir sayısı. */
  appreciationCount: number;
  /** Takdirlerin genel puana toplam katkısı. */
  appreciationPoints: number;
  /** Bir takdirin bu dönemdeki puan karşılığı. */
  appreciationPointsPer: number;
}

function scoreDetails(
  score: ScoreResult,
  input: ScoreInput,
): Pick<
  UserScore,
  "baseTotal" | "appreciationCount" | "appreciationPoints" | "appreciationPointsPer"
> {
  const appreciationCount = Math.max(
    0,
    Math.trunc(input.appreciationCount ?? score.appreciationCount ?? 0),
  );
  const appreciationPointsPer = Math.max(
    0,
    Math.trunc(input.appreciationPointsPer ?? score.appreciationPointsPer ?? 0),
  );
  const appreciationPoints =
    score.appreciationPoints ?? appreciationCount * appreciationPointsPer;

  return {
    baseTotal: score.baseTotal ?? score.total - appreciationPoints,
    appreciationCount,
    appreciationPoints,
    appreciationPointsPer,
  };
}

/**
 * Canlı dönemin sınırları: payda **bugüne kadar** sayılır (denetim
 * 23.08.2026, bulgu 7).
 *
 * Payda ay sonuna kadar alınıyordu ve ayın 3'ünde kullanıcı, henüz
 * yaşanmamış 20 iş gününde kayıt girmemiş sayılıyordu: skor ay boyunca
 * sistematik olarak düşük görünüyor, ay sonuna doğru kendiliğinden
 * "düzeliyordu". Kapanmış dönemde tam ay kullanılmaya devam ediyor — orada
 * bütün günler yaşandı.
 */
export function livePeriodBounds(now: Date): { from: Date; to: Date } {
  const { from, to } = periodBounds(now);
  const bugun = new Date(`${companyDay(now)}T00:00:00.000Z`);

  return { from, to: bugun < to ? bugun : to };
}

/**
 * Dönemin ilk ve son günü.
 *
 * **Dönem aylıktır ve ayar değildir** (ürün sahibi kararı, 23.08.2026; açık
 * soru 20, tasarım "Ayarlar" bölümü). Uzunluğu değiştirilebilir yapmak panele
 * bir alan eklemek değildir: kapanmış `UserScorePeriod` satırları yazıldıkları
 * uzunlukla durur, kapanış işçisinin "bir önceki ay" semantiği ve "kaç dönem
 * düşüş" eşiğinin anlamı birlikte değişir.
 */
export function periodBounds(now: Date): { from: Date; to: Date } {
  const gun = companyDay(now);
  const [yil, ay] = gun.split("-").map(Number);

  return {
    from: new Date(Date.UTC(yil as number, (ay as number) - 1, 1)),
    to: new Date(Date.UTC(yil as number, ay as number, 0)),
  };
}

/** Bu kişi skorlanıyor mu: ayar açık, `isScored` ve `writesActivities`. */
async function skorlanirMi(db: ScoreReadDb, userId: string): Promise<boolean> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.scoringEnabled)))
    return false;

  const kisi = await db.user.findUnique({
    where: { id: userId },
    select: { isScored: true, writesActivities: true, isActive: true },
  });

  return Boolean(kisi?.isActive && kisi.isScored && kisi.writesActivities);
}

/** Bakan kişi hedefin skorunu görebilir mi. */
async function gorebilirMi(
  db: ScoreReadDb,
  viewer: Viewer,
  targetId: string,
): Promise<boolean> {
  if (viewer.id === targetId) return true;

  const astlar = await subordinateUserIds(db, viewer.id);
  return astlar.includes(targetId);
}

export async function readUserScore(
  db: ScoreReadDb,
  viewer: Viewer,
  userId: string,
  now: Date,
): Promise<UserScore | null> {
  if (!(await gorebilirMi(db, viewer, userId))) return null;
  if (!(await skorlanirMi(db, userId))) return null;

  const { from, to } = livePeriodBounds(now);

  const [kisi, girdi, agirliklar] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        isUnitManager: true,
        orgUnit: { select: { requiresApproval: true } },
      },
    }),
    // Canlı dönemde zaman damgalı olayların üst sınırı **gerçek an**: bugün
    // gün içinde verilen karar ve yazılan cevap da görünmeli (P3-3).
    collectScoreInput(db, viewer, userId, from, to, now),
    readScoreWeights(db),
  ]);

  if (!kisi) return null;

  const profil = resolveScoreProfile({
    isUnitManager: kisi.isUnitManager,
    requiresApproval: kisi.orgUnit.requiresApproval,
  });

  const sonuc = computeScore(profil, girdi, agirliklar);
  const ayrinti = scoreDetails(sonuc, girdi);

  return {
    userId,
    periodStart: from.toISOString().slice(0, 10),
    expectedDays: girdi.expectedDays,
    writtenDays: girdi.writtenDays,
    writtenCount: girdi.writtenCount,
    approvedCount: girdi.approvedCount,
    decidedCount: girdi.decidedCount,
    decidedOnTimeCount: girdi.decidedOnTimeCount,
    followUpTotal: girdi.followUpTotal,
    followUpHandled: girdi.followUpHandled,
    profile: profil,
    weights: profileWeights(profil, agirliklar),
    ...sonuc,
    ...ayrinti,
  };
}

/** Yöneticinin ekibindeki skorlar; kapsam dışı kimse listede yok. */
export async function readTeamScores(
  db: ScoreReadDb,
  viewer: Viewer,
  now: Date,
): Promise<(UserScore & { fullName: string })[]> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.scoringEnabled))) return [];

  const astlar = await subordinateUserIds(db, viewer.id);
  if (astlar.length === 0) return [];

  const kisiler = await db.user.findMany({
    where: {
      id: { in: astlar },
      isActive: true,
      isScored: true,
      writesActivities: true,
    },
    select: {
      id: true,
      fullName: true,
      isUnitManager: true,
      orgUnit: { select: { requiresApproval: true } },
    },
    // Varsayılan sıralama **alfabetik**, skora göre değil: varsayılan
    // sıralama ekranın ne hakkında olduğunu söyler ve skora göre açılan bir
    // liste "bu bir yarışma" der.
    orderBy: { fullName: "asc" },
  });

  if (kisiler.length === 0) return [];

  // **Kişi başına hesap yok** (denetim 23.08.2026, bulgu 9).
  //
  // Önceki hâli listeyi dolaşıp her kişi için `readUserScore` çağırıyordu;
  // her çağrı takvim, izin, faaliyet, karar ve takip sorguları koşturuyordu.
  // Ölçüldü: 20 kişide 985, 40 kişide 1955 sorgu — tam doğrusal. Tasarım
  // 40 kişilik ekipte 40 ayrı canlı hesabı açıkça yasaklıyor.
  //
  // Görünürlük kuralı değişmedi: kapsam **bakanın** kapsamı ve bir kez
  // çözülüyor, bütün kişilere aynı süzgeç uygulanıyor.
  const { from, to } = livePeriodBounds(now);

  const [ctx, agirliklar] = await Promise.all([
    loadScoreContext(db, viewer),
    readScoreWeights(db),
  ]);

  const girdiler = await collectScoreInputs(
    db,
    ctx,
    kisiler.map((k) => k.id),
    from,
    to,
    // Canlı dönemde zaman damgalı olayların üst sınırı **gerçek an**: bugün
    // gün içinde verilen karar ve yazılan cevap da görünmeli (P3-3).
    now,
  );

  const periodStart = from.toISOString().slice(0, 10);

  return kisiler.flatMap((kisi) => {
    const girdi = girdiler.get(kisi.id);
    if (!girdi) return [];

    const profil = resolveScoreProfile({
      isUnitManager: kisi.isUnitManager,
      requiresApproval: kisi.orgUnit.requiresApproval,
    });
    const sonuc = computeScore(profil, girdi, agirliklar);
    const ayrinti = scoreDetails(sonuc, girdi);

    return [
      {
        userId: kisi.id,
        fullName: kisi.fullName,
        periodStart,
        expectedDays: girdi.expectedDays,
        writtenDays: girdi.writtenDays,
        writtenCount: girdi.writtenCount,
        approvedCount: girdi.approvedCount,
        decidedCount: girdi.decidedCount,
        decidedOnTimeCount: girdi.decidedOnTimeCount,
        followUpTotal: girdi.followUpTotal,
        followUpHandled: girdi.followUpHandled,
        profile: profil,
        weights: profileWeights(profil, agirliklar),
        ...sonuc,
        ...ayrinti,
      },
    ];
  });
}

/** Düşüş işareti eşiği; metinde geçsin diye taşınır. */
export async function readDeclineThreshold(db: ScoreReadDb): Promise<number> {
  return readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods);
}

/** Grafikte gösterilen dönem sayısı; hesap eşiğe göre daha derine bakar. */
const GRAFIK_DONEMI = 6;

export interface ScoreTrend {
  /** Yeniden eskiye, en fazla altı dönem. */
  periods: { periodStart: string; total: number }[];
  /**
   * Ayarda yazan sayı kadar dönem **üst üste** düşüş var mı.
   *
   * Skorun en değerli kullanımı sıralamak değil düşüşü yakalamaktır:
   * "7. sırada" bir şey söylemez — 40 kişilik listede biri zaten 7. olacaktır
   * — "üç dönemdir düşüyor" söyler.
   */
  declining: boolean;
}

/** Kaç dönem geriye bakılacağı; hesap eşiğe göre daha derine iner. */
async function donemDerinligi(db: ScoreReadDb): Promise<number> {
  const esik = await readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods);
  return Math.max(GRAFIK_DONEMI, esik);
}

/** Pencere sorgusunun döndürdüğü dönem satırı. */
interface DonemSatiri {
  userId: string;
  periodStart: Date;
  revisionNo: number;
  total: number;
  expectedDays: number;
  formulaVersion: number | null;
  profile: string | null;
  weightRegularity: number | null;
  weightAcceptance: number | null;
  weightApproval: number | null;
  weightFollowUp: number | null;
  appreciationPointsPer: number | null;
}

/** Katkı satırlarından dönemin girdisini kurar. */
function girdiyiKur(
  satir: {
    expectedDays: number;
    formulaVersion: number | null;
    profile: string | null;
    weightRegularity: number | null;
    weightAcceptance: number | null;
    weightApproval: number | null;
    weightFollowUp: number | null;
    appreciationPointsPer: number | null;
  },
  olgular: { kind: string; happenedOn: Date; onTime: boolean }[],
): {
  hesapla: (typeof SCORE_CALCULATORS)[number];
  profil: ScoreProfile;
  agirliklar: ScoreWeights;
  girdi: ScoreInput;
} | null {
  // **Formül sürümü dönemin kendisinden gelir** (P8-5). Tanınmayan sürüm
  // okunmaz: bugünkü algoritmaya düşmek, geçmişi sessizce yeniden
  // yorumlamak olurdu.
  const hesapla =
    satir.formulaVersion === null
      ? undefined
      : SCORE_CALCULATORS[satir.formulaVersion];
  if (!hesapla) return null;

  if (
    satir.profile === null ||
    satir.weightRegularity === null ||
    satir.weightAcceptance === null ||
    satir.weightApproval === null ||
    satir.weightFollowUp === null
  ) {
    return null;
  }

  const yazilanlar = olgular.filter((o) => o.kind === "WRITTEN");
  const kararlar = olgular.filter((o) => o.kind === "DECISION");
  const yukumlulukler = olgular.filter((o) => o.kind === "OBLIGATION");

  return {
    hesapla,
    profil: satir.profile as ScoreProfile,
    agirliklar: {
      regularity: satir.weightRegularity,
      acceptance: satir.weightAcceptance,
      approval: satir.weightApproval,
      followUp: satir.weightFollowUp,
    },
    girdi: {
      // **Payda dönem sonunda dondu**: sonradan iptal edilen izin ya da
      // eklenen tatil kapanmış dönemi değiştiremez.
      expectedDays: satir.expectedDays,
      writtenDays: new Set(
        yazilanlar
          .filter((o) => o.onTime)
          .map((o) => o.happenedOn.toISOString().slice(0, 10)),
      ).size,
      writtenCount: yazilanlar.length,
      approvedCount: olgular.filter((o) => o.kind === "ACCEPTED").length,
      decidedCount: kararlar.length,
      decidedOnTimeCount: kararlar.filter((o) => o.onTime).length,
      followUpTotal: yukumlulukler.length,
      followUpHandled: yukumlulukler.filter((o) => o.onTime).length,
      appreciationCount: olgular.filter((o) => o.kind === "APPRECIATION").length,
      appreciationPointsPer: satir.appreciationPointsPer ?? 0,
    },
  };
}

/**
 * Birden çok kişinin trendi — **kişi sayısından bağımsız** sorguyla.
 *
 * İki bulgu birlikte kapanıyor (ürün sahibi kararı, 24.08.2026):
 *
 * **P3-R2-4 (dondurma).** Kapanmış dönem, başkası baktığında canlı
 * tablolardan yeniden hesaplanıyordu ve hesap **bugünün** verisiyle
 * yapılıyordu: eylülde verilen onay ağustosun kabul oranını değiştiriyor,
 * sonradan iptal edilen izin paydayı büyütüyor, ağırlık ayarı bütün geçmişi
 * yeniden yazıyordu. Artık dönem kapanışta donuyor; okuma anında yalnız
 * **görünürlükten** süzülüyor. Görünürlük yine bugünden gelir — dala
 * sonradan gelen yönetici geçmişi görür (§4.6) — ama *o dönemde ne olduğu*
 * dönem sonundan gelir.
 *
 * **Bulgu 9 (N+1).** Trend kişi başına okunuyordu ve her dönem için ayrı bir
 * çok tablolu hesap koşuyordu: altı dönemlik grafikte kişi başına altı hesap.
 * Şimdi bütün kişilerin bütün dönemleri iki sorguda okunuyor.
 *
 * **Eski dönemler görünmez.** Katkı taşımayan (`frozen = false`) satırlar
 * hiçbir ekrana çıkmaz — ürün sahibi kararı (25.08.2026): "geçmiş
 * temizlensin". Satır fiziksel olarak silinmez (§16.6); okunmaz.
 */
export async function readScoreTrends(
  db: ScoreReadDb,
  viewer: Viewer,
  userIds: string[],
): Promise<Map<string, ScoreTrend>> {
  const sonuc = new Map<string, ScoreTrend>();
  if (userIds.length === 0) return sonuc;

  // **Hedef listesi burada yetkilendirilir** (denetim 25.08.2026,
  // P8-1).
  //
  // Önce çağıranın verdiği liste olduğu gibi sorguya giriyordu. Olguları
  // `visibleActivityWhere` ile süzmek hedef kişiye **erişim denetimi
  // değildir**: kapsam dışı kişi için bile dönem sayısı, donmuş payda ve
  // profil üzerinden hesaplanan bir toplam dönüyordu — kişinin geçmiş
  // çalışma ve izin düzenine ilişkin türetilmiş içerik.
  //
  // "Bugünkü çağıran zaten kapsamlı liste üretiyor" savunması yetmez:
  // güvenlik servis sınırında durmalı, çağıranın sırasına bırakılmamalı
  // (§18.4). Kapsam **bir kez** çözülüyor; toplu yol bozulmuyor.
  const astlar = await subordinateUserIds(db, viewer.id);
  const kapsamdakiler = new Set([viewer.id, ...astlar]);
  const izinliler = userIds.filter((id) => kapsamdakiler.has(id));
  if (izinliler.length === 0) return sonuc;

  const [esik, derinlik] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods),
    donemDerinligi(db),
  ]);

  // **Yalnız gereken dönemler çekilir** (denetim 25.08.2026, P8-8).
  //
  // Önce bütün donmuş dönemler getirilip bellekte kesiliyordu: sorgu sayısı
  // sabit kalsa da taşınan satır tarihçeyle doğrusal büyüyordu. Altmış
  // dönemlik bir kişide 60 dönem ve 1200 katkı satırı ağdan geçiyordu; oysa
  // ekranın ve düşüş hesabının ihtiyacı en yeni `max(6, eşik)` dönem.
  //
  // Pencere işlevi kişi başına sıralamayı **veritabanında** yapıyor.
  const satirlar = await db.$queryRaw<DonemSatiri[]>`
    WITH son_surum AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY "userId", "periodStart"
               ORDER BY "revisionNo" DESC
             ) AS surum_sirasi
        FROM "UserScorePeriod"
       WHERE "userId" = ANY(${izinliler}) AND "frozen"
    ), donemler AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY "userId" ORDER BY "periodStart" DESC
             ) AS donem_sirasi
        FROM son_surum
       -- Önce en yeni sürüm seçilir, sonra geçersiz kılma mührü elenir.
       -- Ters sıra eski ve yanlış sürümü yeniden görünür yapardı.
       WHERE surum_sirasi = 1 AND NOT "voided"
    )
    SELECT "userId", "periodStart", "revisionNo", "total", "expectedDays", "formulaVersion",
           "profile", "weightRegularity", "weightAcceptance",
           "weightApproval", "weightFollowUp", "appreciationPointsPer"
      FROM donemler
     WHERE donem_sirasi <= ${derinlik}
     ORDER BY "userId", "periodStart" DESC
  `;

  const kisiSatirlari = new Map<string, DonemSatiri[]>();
  for (const satir of satirlar) {
    const mevcut = kisiSatirlari.get(satir.userId) ?? [];
    mevcut.push(satir);
    kisiSatirlari.set(satir.userId, mevcut);
  }

  // **Kişinin kendi satırı yeniden hesaplanmaz**: satır zaten onun
  // kapsamıyla yazıldı ve yeniden hesaplamak kapanıştan sonra düzeltilen bir
  // geçmişi sessizce değiştirirdi.
  // **Olgu sorgusu kişi-dönem çiftlerine bağlanır** (denetim
  // 25.08.2026, P8-R2-5).
  //
  // Önce tarihlerin **birleşimi** kullanılıyordu: uzun tarihçeli birinin
  // ekrandan kesilmiş eski dönemleri, kısa tarihçeli başka birinin seçilen
  // tarihlerine denk geldiği için yeniden sorguya giriyordu. İki kullanıcılı
  // asimetrik örnekte ihtiyaç 120 satırken 180 satır taşınıyordu.
  const okunanCiftler = satirlar
    .filter((satir) => satir.userId !== viewer.id)
    .map((satir) => ({
      userId: satir.userId,
      periodStart: satir.periodStart,
      revisionNo: satir.revisionNo,
    }));

  const olgular =
    okunanCiftler.length === 0
      ? []
      : await db.userScorePeriodFact.findMany({
          where: {
            // Yalnız seçilen **kişi-dönem** çiftleri; bütün geçmişin
            // olgularını çekmek satır sayısını tarihçeyle büyütüyordu (P8-8).
            OR: okunanCiftler,
            // Görünürlük süzgeci **katkının faaliyeti** üzerinden: bakanın
            // göremediği kayıt toplama girmez (§18.4).
            activity: await visibleActivityWhere(db, viewer),
          },
          select: {
            userId: true,
            periodStart: true,
            revisionNo: true,
            kind: true,
            happenedOn: true,
            onTime: true,
          },
        });

  const olguIndeksi = new Map<string, typeof olgular>();
  for (const olgu of olgular) {
    const anahtar = `${olgu.userId}|${olgu.periodStart.toISOString().slice(0, 10)}|${olgu.revisionNo}`;
    const mevcut = olguIndeksi.get(anahtar) ?? [];
    mevcut.push(olgu);
    olguIndeksi.set(anahtar, mevcut);
  }

  for (const userId of izinliler) {
    const kendi = userId === viewer.id;
    const kisiSatir = kisiSatirlari.get(userId) ?? [];

    const toplamlar = kisiSatir.flatMap((satir) => {
      const gun = satir.periodStart.toISOString().slice(0, 10);

      // **Tanınmayan sürüm sahibine de gösterilmez** (denetim
      // 25.08.2026, P8-R2-4). Önce yalnız başka bakan için kontrol ediliyordu;
      // sahibine saklanan `total` veriliyordu. Aynı dönem için iki bakanın
      // biri sayı görüp diğeri görmemesi, paketin kapatmak istediği
      // tutarsızlığın ta kendisi.
      if (satir.formulaVersion === null || !SCORE_CALCULATORS[satir.formulaVersion]) {
        return [];
      }

      if (kendi) return [{ periodStart: gun, total: satir.total }];

      const kurulum = girdiyiKur(
        satir,
        olguIndeksi.get(`${userId}|${gun}|${satir.revisionNo}`) ?? [],
      );
      // Formülü taşımayan satır okunamaz; sessizce bugünkü ayarla hesaplamak
      // tam da kapatılan hatanın kendisi olurdu.
      if (!kurulum) return [];

      return [
        {
          periodStart: gun,
          total: kurulum.hesapla(
            kurulum.profil,
            kurulum.girdi,
            kurulum.agirliklar,
          ).total,
        },
      ];
    });

    sonuc.set(userId, {
      periods: toplamlar.slice(0, GRAFIK_DONEMI),
      declining: dususVarMi(toplamlar, esik),
    });
  }

  return sonuc;
}

/** Yeniden eskiye bakıldığında eşik kadar dönem üst üste düşmüş mü. */
function dususVarMi(toplamlar: { total: number }[], esik: number): boolean {
  // Her adımda **bir öncekinden düşük** olması aranıyor; arada tek bir
  // yükselme seriyi kırar.
  let ardisik = 0;
  for (let i = 0; i + 1 < toplamlar.length; i += 1) {
    const yeni = toplamlar[i]?.total ?? 0;
    const eski = toplamlar[i + 1]?.total ?? 0;
    if (yeni < eski) ardisik += 1;
    else break;
  }

  // **Eşik dönem sayısıdır, geçiş sayısı değil** (denetim 23.08.2026,
  // bulgu 7). Üç dönemlik `91 → 78 → 64` dizisinde iki geçiş vardır ve
  // tasarımın "üç dönemdir düşüyor" örneği tam olarak bu diziyi anlatır.
  // Geçiş sayısı olarak okunduğunda işaret bir dönem geç yanıyordu.
  return ardisik >= Math.max(1, esik - 1);
}

/** Kişinin son dönemleri ve düşüş işareti; kapsam dışında boş döner. */
export async function readScoreTrend(
  db: ScoreReadDb,
  viewer: Viewer,
  userId: string,
): Promise<ScoreTrend> {
  // Trend de bir okuma yoludur: kapsam dışı kişinin geçmişi görünmez.
  if (!(await gorebilirMi(db, viewer, userId))) {
    return { periods: [], declining: false };
  }

  const hepsi = await readScoreTrends(db, viewer, [userId]);
  return hepsi.get(userId) ?? { periods: [], declining: false };
}
