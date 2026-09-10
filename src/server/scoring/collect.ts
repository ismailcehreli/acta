import type { FollowUpEventKind, PrismaClient } from "@prisma/client";

import {
  companyDay,
  companyDayStart,
  nextCompanyDayStart,
  toDateValue,
} from "@/shared/format/date-time";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import type { CompanyWorkCalendar } from "@/server/calendar/work-calendar";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
  type UnitCalendarIndex,
} from "@/server/calendar/unit-calendar";
import {
  SETTING_KEYS,
  readNumericSetting,
} from "@/server/settings/system-settings";

import type { ScoreInput } from "./compute";

/** Sayılar ve onları doğuran olgular birlikte. */
export type ScoreInputWithFacts = ScoreInput & { facts: ScoreFactRow[] };

/** Kapanışta yazılacak tek bir katkı olgusu. */
export interface ScoreFactRow {
  activityId: string;
  kind: "WRITTEN" | "ACCEPTED" | "DECISION" | "OBLIGATION" | "APPRECIATION";
  /** `YYYY-MM-DD`. */
  happenedOn: string;
  onTime: boolean;
}
import {
  cevapYukumlulukleri,
  donemeGiriyorMu,
  maddeKapanisi,
  maddeSonHareketi,
} from "./follow-up-discipline";

// Skorun **paydası** (Görev 11.10).
//
// Payda üç şeye bağlı ve üçü de bu görevden önce kuruldu:
//
//   · `writesActivities: false` olan kişi hiç sayılmaz (§7.4 istisnası).
//   · "Faaliyet beklenmiyor" dönemleri düşer (Görev 11.8). İptal edilmiş
//     dönem **hiç yaşanmamış** sayılır (denetim 21.08.2026, bulgu 7).
//   · Hangi günlerin iş günü olduğunu **birimin** çalışma takvimi söyler
//     (Görev 11.9): cumartesi çalışan depo için cumartesiler paydada.
//
// Skorun plana en sona konmasının sebebi buydu.

export type ScoreCollectDb = VisibilityDb &
  Pick<
  PrismaClient,
  | "activity"
  | "user"
  | "noActivityPeriod"
  | "holiday"
  | "workCalendar"
  | "orgUnit"
  | "orgUnitWorkCalendar"
  | "approvalRound"
  | "followUpItem"
  | "conversation"
  | "conversationMessage"
  | "activityAppreciation"
  | "systemSetting"
  >;

/** `YYYY-MM-DD` günlerini sırayla verir. */
function gunAralik(from: Date, to: Date): string[] {
  const gunler: string[] = [];
  const imlec = new Date(from);

  while (imlec <= to) {
    gunler.push(imlec.toISOString().slice(0, 10));
    imlec.setUTCDate(imlec.getUTCDate() + 1);
  }

  return gunler;
}

/**
 * Birimin takvimine göre dönemdeki iş günleri.
 *
 * Şirket takvimi değil **birimin** penceresi kullanılıyor: cumartesi çalışan
 * bir depoda cumartesiler beklenen gündür ve o kişinin paydası daha büyüktür.
 */
export async function expectedWorkDays(
  db: ScoreCollectDb,
  orgUnitId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
  const [indeks, takvim] = await Promise.all([
    loadUnitCalendarIndex(db),
    loadWorkCalendar(db, from, to),
  ]);

  return expectedWorkDaysFrom(indeks, orgUnitId, from, to, takvim.holidays);
}

/**
 * Aynı hesap, **sorgusuz**: ağaç/takvim indeksi ve tatiller dışarıdan gelir.
 *
 * Toplu yol bunu kullanıyor; aynı birimdeki kırk kişi için ağacı kırk kez
 * yüklemek bulgu 9'un ta kendisiydi.
 */
export function expectedWorkDaysFrom(
  indeks: UnitCalendarIndex,
  orgUnitId: string,
  from: Date,
  to: Date,
  holidays: string[],
): string[] {
  const pencere = resolveUnitWorkWindowFrom(indeks, orgUnitId);
  const tatiller = new Set(holidays);

  return gunAralik(from, to).filter((gun) => {
    const isoGun = new Date(`${gun}T00:00:00.000Z`).getUTCDay() || 7;
    if (!pencere.workingDays.includes(isoGun)) return false;

    // Tatilde çalışan birimde tatil de iş günüdür (Görev 11.9).
    if (tatiller.has(gun) && !pencere.worksOnHolidays) return false;

    return true;
  });
}

/**
 * Bir kişinin dönemdeki skor girdisi.
 *
 * **Sayı değil gün** sayılıyor: aynı günde beş kayıt bir gün. Sayı
 * ödüllendirilseydi bir işi anlatan tek kayıt yerine onu bölen beş kayıt
 * yazılırdı ve sistem dolarken içerik boşalırdı.
 */
export async function collectScoreInput(
  db: ScoreCollectDb,
  viewer: Viewer,
  userId: string,
  /** Dönemin ilk günü (gün alanı). */
  from: Date,
  /** Dönemin son günü (gün alanı). */
  to: Date,
  /**
   * Zaman damgalı olaylar için **dışlayıcı** üst an. Canlı dönemde gerçek
   * `now`, kapanmış dönemde son günü izleyen şirket gününün başlangıcı.
   *
   * Gün alanı ile zaman damgası aynı sınırla karşılaştırılamaz: "31 Ağustos"
   * bir gün alanı için kapsayıcıdır, bir zaman damgası için o günün 00:00'ı
   * ve gün içindeki her şeyi dışarıda bırakır (denetim 23.08.2026,
   * P3-3).
   */
  until: Date = nextCompanyDayStart(companyDay(to)),
): Promise<ScoreInputWithFacts> {
  // **Tek kişilik yol da toplu yoldan geçer** (denetim 25.08.2026,
  // P8-2 çalışmasında birleştirildi).
  //
  // İki ayrı toplama vardı ve seçimleri elle eşlenmişti; birinde düzeltilen
  // bir kural diğerinde eksik kalabiliyordu. Kapanış tek kişilik yolu, ekran
  // toplu yolu kullandığı için ayrışma doğrudan "kapanan skor ile ekranda
  // görünen skor farklı" demekti.
  const ctx = await loadScoreContext(db, viewer);
  const hepsi = await collectScoreInputs(db, ctx, [userId], from, to, until);

  return hepsi.get(userId) ?? BOS_GIRDI;
}

/** Kişi bulunamadığında; sıfır değil, **ölçülmeyen** dönem demek. */
const BOS_GIRDI: ScoreInputWithFacts = {
  expectedDays: 0,
  writtenDays: 0,
  writtenCount: 0,
  approvedCount: 0,
  decidedCount: 0,
  decidedOnTimeCount: 0,
  followUpTotal: 0,
  followUpHandled: 0,
  appreciationCount: 0,
  appreciationPointsPer: 0,
  facts: [],
};

/**
 * Bir kişinin dönem girdisini **sorgusuz** hesaplar.
 *
 * Toplama ile hesap ayrıldı (denetim 23.08.2026, bulgu 9): tek kişilik
 * ve toplu yollar aynı hesabı çağırıyor, dolayısıyla ikisinin ayrışması
 * mümkün değil. Ayrışsalardı ekip listesi ile profil aynı kişi için farklı
 * skor gösterebilirdi.
 */
export function hesaplaScoreInput(girdi: {
  userId: string;
  anBasi: Date;
  until: Date;
  olcumAni: Date;
  isGunleri: string[];
  izinler: { startDate: Date; endDate: Date }[];
  kayitlar: {
    id: string;
    activityDate: Date;
    approvalStatus: string;
    approverId: string | null;
    /** Dönem sonuna kadar verilmiş **son** karar; yoksa boş. */
    approvalRounds: { decision: string | null; decidedAt: Date | null }[];
  }[];
  kararlar: { activityId: string; submittedAt: Date; decidedAt: Date | null }[];
  maddeler: {
    activityId: string;
    openedAt: Date;
    events: { kind: FollowUpEventKind; createdAt: Date }[];
  }[];
  konusmalar: {
    activityId: string;
    askerId: string;
    openedAt: Date;
    closedAt: Date | null;
    activity: { authorId: string };
    messages: { authorId: string; createdAt: Date }[];
  }[];
  takdirler: { activityId: string; createdAt: Date }[];
  takvimAyari: { workingDays: number[] };
  sirketTakvimi: { holidays: string[] };
  onayEsigi: number;
  cevapEsigi: number;
  maddeEsigi: number;
  appreciationPointsPer: number;
}): ScoreInputWithFacts {
  const {
    userId,
    anBasi,
    until,
    olcumAni,
    isGunleri,
    izinler,
    kayitlar,
    kararlar,
    maddeler,
    konusmalar,
    takdirler,
    appreciationPointsPer,
    takvimAyari,
    sirketTakvimi,
    onayEsigi,
    cevapEsigi,
    maddeEsigi,
  } = girdi;

  const takvim = {
    workingDays: takvimAyari.workingDays,
    holidays: sirketTakvimi.holidays,
  };

  // İzin günleri paydadan düşer.
  const izinliGunler = new Set<string>();
  for (const izin of izinler) {
    for (const gun of gunAralik(izin.startDate, izin.endDate)) {
      izinliGunler.add(gun);
    }
  }
  const beklenen = isGunleri.filter((gun) => !izinliGunler.has(gun));

  // **Gün** sayılıyor, kayıt değil.
  //
  // Pay, paydanın günleriyle **kesiştiriliyor** (denetim 23.08.2026,
  // bulgu 10 çalışmasında bulundu). Payda beklenen iş günleri: hafta sonu,
  // resmî tatil ve "faaliyet beklenmiyor" dönemleri düşüyor. Pay ise kaydın
  // olduğu her günü sayıyordu; kişi izindeyken, hafta sonunda ya da tatilde
  // bir kayıt yazdığında pay büyüyor, payda küçülüyordu ve oran %100'ü
  // aşabiliyordu.
  //
  // Sonuç yalnız yanlış bir sayı değildi: `UserScorePeriod_valid_days` kısıtı
  // `writtenDays > expectedDays` satırını reddediyor ve **dönem kapanış
  // işçisi hata veriyordu** — o ayın hiçbir kişisi için skor yazılamıyordu.
  // Kabul ölçümünün skor dönemi üretimi bu yüzden çöktü.
  //
  // Düzenlilik "beklenen günün kaçında yazdı" sorusudur; beklenmeyen günde
  // yazmak bu soruyu cevaplamaz. Kayıt kaybolmuyor — akışta, listede ve
  // aramada duruyor; yalnız bu **orana** girmiyor.
  const beklenenKume = new Set(beklenen);
  const yazilanGunler = new Set(
    kayitlar
      .map((k) => companyDay(toDateValue(k.activityDate.toISOString().slice(0, 10))))
      .filter((gun) => beklenenKume.has(gun)),
  );

  // **Kabul dönem sonundaki gerçeğe göre** (denetim 25.08.2026, P8-2).
  //
  // Önce güncel `approvalStatus` okunuyordu: dönem bittikten sonra ama işçi
  // koşmadan önce verilen bir onay geçmiş döneme kabul yazıyordu. Onaya tabi
  // kayıtta cevap **karar turlarından** geliyor; onaya tabi olmayan birimde
  // kayıt zaten onaylı doğuyor ve turu hiç olmuyor.
  const donemSonundaKabul = (k: (typeof kayitlar)[number]): boolean => {
    if (k.approverId === null) {
      // Onaya tabi olmayan birim: doğuşta onaylı. İptal edilmişse buraya
      // zaten gelmiyor (iptal dönem içindeyse süzüldü).
      return k.approvalStatus !== "REJECTED";
    }
    return k.approvalRounds[0]?.decision === "APPROVED";
  };

  const onaylanan = kayitlar.filter(donemSonundaKabul).length;
  const onayliKayitIds = new Set(
    kayitlar.filter(donemSonundaKabul).map((kayit) => kayit.id),
  );
  const gecerliTakdirler = takdirler.filter((takdir) =>
    onayliKayitIds.has(takdir.activityId),
  );

  // **Onay süresi gerçekten ölçülüyor** (denetim 23.08.2026, bulgu 6).
  //
  // Eskiden `decidedOnTimeCount` koşulsuz olarak karar sayısına eşitleniyordu:
  // gönderim ve karar anları seçildiği hâlde aradaki iş günü hiç
  // hesaplanmıyor, geç karar veren her yönetici bu boyuttan tam puan
  // alıyordu. Boyut, ölçtüğünü iddia ettiği şeyi ölçmüyordu.
  //
  // Sayaç **şirket geneli** takvimden besleniyor (tasarım satır 440: "iş günü
  // sayacı şirket geneli, tek") ve eşik, hatırlatmanın kullandığı ayarın ta
  // kendisi: iki yol ayrışsaydı, sistem "geç kaldın" diye hatırlatırken skor
  // "zamanında" derdi.
  const zamaninda = kararlar.filter(
    (k) => businessDaysBetween(k.submittedAt, k.decidedAt!, takvim) < onayEsigi,
  ).length;

  // **Takip disiplini = zamanında ele almak.**
  //
  // Madde: dönem sonuna kadar kapandıysa başarı; hâlâ açıksa ancak eşiği
  // aşmamışsa. Ölçü **açılış anından** işliyor — tasarımın ölçtüğü şey
  // maddeyi kapatmak. Güncel `lastMovedAt` kullanılmıyor: dönem kapandıktan
  // sonra gelen bir hareket geçmişi değiştirirdi (P3-2).
  const donemMaddeleri = maddeler
    .map((madde) => {
      const gorunum = { openedAt: madde.openedAt, olaylar: madde.events };
      return {
        activityId: madde.activityId,
        openedAt: madde.openedAt,
        kapanis: maddeKapanisi(gorunum),
        sonHareket: maddeSonHareketi(gorunum),
      };
    })
    .filter(({ kapanis }) => kapanis === null || kapanis >= anBasi);

  const maddeEleAlindi = ({
    kapanis,
    sonHareket,
  }: {
    kapanis: Date | null;
    sonHareket: Date;
  }): boolean =>
    kapanis !== null
      ? true
      : businessDaysBetween(sonHareket, olcumAni, takvim) < maddeEsigi;

  const eleAlinanMaddeler = donemMaddeleri.filter(maddeEleAlindi).length;

  // Soru: karşı tarafın açtığı her tur bir cevap borcudur. Dönemle kesişen
  // borçlar paydada; eşiği aşmadan kapananlar payda.
  const borclar = konusmalar
    .flatMap((konusma) =>
      cevapYukumlulukleri(
        {
          askerId: konusma.askerId,
          respondentId: konusma.activity.authorId,
          openedAt: konusma.openedAt,
          kapanis: konusma.closedAt,
          mesajlar: konusma.messages,
        },
        userId,
        olcumAni,
      ).map((borc) => ({ ...borc, activityId: konusma.activityId })),
    )
    .filter((borc) => donemeGiriyorMu(borc, anBasi, until))
    // **Cevapsız kapanan soru ölçümden düşer** (ürün sahibi kararı,
    // 23.08.2026; denetim P3-R2-2). Konuşmayı soran da sistem
    // yöneticisi de kapatabilir; kişi cevap yazma fırsatını kaybetti. Başarı
    // saymak puanı **başkasının** eylemine bağlardı, başarısızlık saymak da
    // kişinin yapmadığı bir şeyi cezalandırırdı.
    .filter((borc) => borc.sonu !== "KAPANDI");

  const borcZamaninda = (borc: { basladi: Date; bitti: Date }): boolean =>
    businessDaysBetween(borc.basladi, borc.bitti, takvim) < cevapEsigi;

  const cevaplananSorular = borclar.filter(borcZamaninda).length;

  // ── Katkı satırları ────────────────────────────────────────────────────
  //
  // Aynı hesaptan **olgular** da çıkıyor (P3-R2-4). Dönem kapanışı bunları
  // yazıyor; kapanmış dönem sonradan yeniden hesaplanmıyor, yalnız bu
  // satırlar bakanın görünürlüğünden süzülüyor. Sayılar ile olguların tek
  // yerden çıkması şart: ayrı hesaplanan bir olgu kümesi, canlı dönemle
  // kapanmış dönemin sessizce ayrışması demekti.
  const facts: ScoreFactRow[] = [
    ...kayitlar.map((k) => {
      const gun = companyDay(toDateValue(k.activityDate.toISOString().slice(0, 10)));
      return {
        activityId: k.id,
        kind: "WRITTEN" as const,
        happenedOn: gun,
        // Düzenliliğin payına yalnız **beklenen güne** düşen kayıt girer;
        // kabul oranının paydası ise bütün kayıtlardır.
        onTime: beklenenKume.has(gun),
      };
    }),
    ...kayitlar
      .filter(donemSonundaKabul)
      .map((k) => ({
        activityId: k.id,
        kind: "ACCEPTED" as const,
        happenedOn: companyDay(toDateValue(k.activityDate.toISOString().slice(0, 10))),
        onTime: true,
      })),
    ...kararlar.map((k) => ({
      activityId: k.activityId,
      kind: "DECISION" as const,
      happenedOn: companyDay(k.decidedAt!),
      onTime: businessDaysBetween(k.submittedAt, k.decidedAt!, takvim) < onayEsigi,
    })),
    ...donemMaddeleri.map((madde) => ({
      activityId: madde.activityId,
      kind: "OBLIGATION" as const,
      happenedOn: companyDay(madde.kapanis ?? madde.openedAt),
      onTime: maddeEleAlindi(madde),
    })),
    ...borclar.map((borc) => ({
      activityId: borc.activityId,
      kind: "OBLIGATION" as const,
      happenedOn: companyDay(borc.bitti),
      onTime: borcZamaninda(borc),
    })),
    ...gecerliTakdirler.map((takdir) => ({
      activityId: takdir.activityId,
      kind: "APPRECIATION" as const,
      happenedOn: companyDay(takdir.createdAt),
      onTime: true,
    })),
  ];

  return {
    expectedDays: beklenen.length,
    writtenDays: yazilanGunler.size,
    writtenCount: kayitlar.length,
    approvedCount: onaylanan,
    // Gönderim anı olmayan kayıt **hiçbir tarafta** sayılmaz: ölçülemeyen bir
    // kararı paydaya koyup paydan düşmek, veri eksikliğini yöneticinin
    // hatasıymış gibi gösterirdi.
    decidedCount: kararlar.length,
    decidedOnTimeCount: zamaninda,
    followUpTotal: donemMaddeleri.length + borclar.length,
    followUpHandled: eleAlinanMaddeler + cevaplananSorular,
    appreciationCount: gecerliTakdirler.length,
    appreciationPointsPer,
    facts,
  };
}


// ── Toplu toplama ────────────────────────────────────────────────────────
//
// Ekip listesi kişileri sırayla dolaşıp her biri için ayrı bir çok tablolu
// hesap koşturuyordu (denetim 23.08.2026, bulgu 9). Ölçüldü: 20 kişide
// 985, 40 kişide 1955 sorgu — kişi başına ~49. Tasarım bunu açıkça yasaklıyor.
//
// Buradaki yol aynı veriyi **kişi sayısından bağımsız** sayıda sorguyla
// topluyor: her tablo bir kez `userId IN (…)` ile okunuyor, gruplama bellekte
// yapılıyor. Hesabın kendisi değişmiyor — tek kişilik yol da toplu yol da
// `hesaplaScoreInput` çağırıyor.

/** İstek başına bir kez yüklenen, kişiden bağımsız bağlam. */
export interface ScoreContext {
  /** Bakanın görebildiği kayıtların koşulu; bir kez çözülür. */
  kapsam: Awaited<ReturnType<typeof visibleActivityWhere>>;
  takvimIndeksi: UnitCalendarIndex;
  takvimAyari: { workingDays: number[] };
  onayEsigi: number;
  cevapEsigi: number;
  maddeEsigi: number;
  appreciationPointsPer: number;
}

export async function loadScoreContext(
  db: ScoreCollectDb,
  viewer: Viewer,
): Promise<ScoreContext> {
  const [
    kapsam,
    takvimIndeksi,
    takvimAyari,
    onayEsigi,
    cevapEsigi,
    maddeEsigi,
    appreciationPointsPer,
  ] =
    await Promise.all([
      visibleActivityWhere(db, viewer),
      loadUnitCalendarIndex(db),
      readWorkCalendar(db),
      readNumericSetting(db, SETTING_KEYS.pendingApprovalBusinessDays),
      readNumericSetting(db, SETTING_KEYS.overdueAnswerBusinessDays),
      readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
      readNumericSetting(db, SETTING_KEYS.scoringAppreciationPoints),
    ]);

  return {
    kapsam,
    takvimIndeksi,
    takvimAyari: { workingDays: takvimAyari.workingDays },
    onayEsigi,
    cevapEsigi,
    maddeEsigi,
    appreciationPointsPer,
  };
}

/** Listeyi anahtara göre gruplar; eksik anahtar boş dizi verir. */
function grupla<T>(satirlar: T[], anahtar: (satir: T) => string): Map<string, T[]> {
  const sonuc = new Map<string, T[]>();
  for (const satir of satirlar) {
    const k = anahtar(satir);
    const mevcut = sonuc.get(k);
    if (mevcut) mevcut.push(satir);
    else sonuc.set(k, [satir]);
  }
  return sonuc;
}

/**
 * Birden çok kişinin dönem girdisi — **kişi sayısından bağımsız** sorguyla.
 *
 * Bakan tektir: kapsam bir kez çözülür ve bütün kişilere aynı süzgeç
 * uygulanır. Tasarımın kuralı korunuyor — herkes bakanın gözünden hesaplanır.
 */
export async function collectScoreInputs(
  db: ScoreCollectDb,
  ctx: ScoreContext,
  userIds: string[],
  from: Date,
  to: Date,
  until: Date = nextCompanyDayStart(companyDay(to)),
  overrides?: {
    /** Tarihsel kapanışta kişinin o dönemdeki birimi. */
    orgUnitByUser?: Map<string, string>;
    /** Tarihsel şirket takvimi ve tatil kümesi. */
    companyCalendar?: CompanyWorkCalendar;
  },
): Promise<Map<string, ScoreInputWithFacts>> {
  const sonuc = new Map<string, ScoreInputWithFacts>();
  if (userIds.length === 0) return sonuc;

  const anBasi = companyDayStart(companyDay(from));
  const olcumAni = new Date(until.getTime() - 1);

  const [
    kisiler,
    izinler,
    kayitlar,
    kararlar,
    maddeler,
    konusmalar,
    takdirler,
  ] =
    await Promise.all([
      db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, orgUnitId: true },
      }),
      db.noActivityPeriod.findMany({
        where: {
          userId: { in: userIds },
          // Bekleyen ve reddedilen talepler ölçümü değiştirmez. Onaylı
          // kayıtlar ise iptal zamanına göre dönem içinde değerlendirilir.
          status: "APPROVED",
          // **İptal dönem sonuna göre değerlendirilir** (denetim
          // 25.08.2026, P8-2). `GECERLI_DONEM` yalnız "bugün iptal değil"
          // diyor; dönem bittikten sonra iptal edilen izin, dönem içinde
          // geçerliydi ve paydadan düşmüş olmalı. Bugünün durumuna bakmak
          // kapanmış dönemin paydasını geç bir iptalle büyütüyordu.
          OR: [{ cancelledAt: null }, { cancelledAt: { gte: until } }],
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { userId: true, startDate: true, endDate: true },
      }),
      activityMaintenanceReader(db).findMany({
        where: {
          AND: [
            ctx.kapsam,
            { authorId: { in: userIds } },
            { activityDate: { gte: from, lte: to } },
            // **İptal dönem sonuna göre** (denetim 25.08.2026, P8-2).
            // Durum kolonuna bakmak, dönem bittikten sonra yapılan bir
            // iptalin kaydı geçmişten silmesi demekti. İptal kaydı zaman
            // damgalı; dönem içinde iptal edilen düşer, sonra edilen kalır.
            {
              OR: [
                { approvalStatus: { not: "CANCELLED" } },
                { cancellation: { createdAt: { gte: until } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          authorId: true,
          activityDate: true,
          approvalStatus: true,
          approverId: true,
          createdAt: true,
          // Kabul, **dönem sonuna kadar verilmiş** karardan çözülür: durum
          // kolonu bugünü söylüyor, tur geçmişi o günü.
          approvalRounds: {
            where: { decidedAt: { not: null, lt: until } },
            orderBy: { roundNo: "desc" },
            take: 1,
            select: { decision: true, decidedAt: true },
          },
          cancellation: { select: { createdAt: true } },
        },
      }),
      db.approvalRound.findMany({
        where: {
          decidedById: { in: userIds },
          decidedAt: { not: null, gte: anBasi, lt: until },
          activity: ctx.kapsam,
        },
        select: {
          activityId: true,
          decidedById: true,
          submittedAt: true,
          decidedAt: true,
        },
      }),
      db.followUpItem.findMany({
        where: {
          openedById: { in: userIds },
          openedAt: { lt: until },
          OR: [{ closedAt: null }, { closedAt: { gte: anBasi } }],
          activity: ctx.kapsam,
        },
        select: {
          activityId: true,
          openedById: true,
          openedAt: true,
          events: {
            where: { createdAt: { lt: until } },
            orderBy: { createdAt: "asc" },
            select: { kind: true, createdAt: true },
          },
        },
      }),
      // Konuşmada kişi **iki taraftan biri** olabilir (§9.2): soran ya da
      // faaliyeti yazan. Toplu sorgu ikisini de getiriyor, hangi kişiye
      // sayılacağı bellekte ayrılıyor.
      db.conversation.findMany({
        where: {
          AND: [
            { activity: ctx.kapsam },
            {
              OR: [
                { askerId: { in: userIds } },
                { activity: { authorId: { in: userIds } } },
              ],
            },
            { openedAt: { lt: until } },
            { OR: [{ closedAt: null }, { closedAt: { gte: anBasi } }] },
          ],
        },
        select: {
          activityId: true,
          askerId: true,
          openedAt: true,
          closedAt: true,
          activity: { select: { authorId: true } },
          messages: {
            where: { createdAt: { lt: until } },
            orderBy: { createdAt: "asc" },
            select: { authorId: true, createdAt: true },
          },
        },
      }),
      db.activityAppreciation.findMany({
        where: {
          createdAt: { gte: from, lt: until },
          activity: {
            AND: [
              ctx.kapsam,
              { authorId: { in: userIds } },
              { activityDate: { gte: from, lte: to } },
            ],
          },
        },
        select: {
          activityId: true,
          createdAt: true,
          activity: { select: { authorId: true } },
        },
      }),
    ]);

  // Şirket takvimi **bir kez**, herkesin en eski çapasından dönem sonuna.
  const capalar: Date[] = [
    from,
    ...kararlar.map((k) => k.submittedAt),
    ...maddeler.map((m) => m.openedAt),
    ...konusmalar.map((c) => c.messages[0]?.createdAt ?? c.openedAt),
  ];
  const enEskiAn = capalar.reduce((min, an) => (an < min ? an : min), from);
  const sirketTakvimi =
    overrides?.companyCalendar ?? (await loadWorkCalendar(db, enEskiAn, to));

  const izinIndeksi = grupla(izinler, (i) => i.userId);
  const kayitIndeksi = grupla(kayitlar, (k) => k.authorId);
  const kararIndeksi = grupla(kararlar, (k) => k.decidedById ?? "");
  const maddeIndeksi = grupla(maddeler, (m) => m.openedById);
  const takdirIndeksi = grupla(takdirler, (t) => t.activity.authorId);

  // İş günleri birim başına bir kez: aynı birimdeki kırk kişi aynı takvimi
  // paylaşıyor ve pencere zaten bellekteki indeksten çözülüyor.
  const birimGunleri = new Map<string, string[]>();
  const isGunleriniAl = (orgUnitId: string): string[] => {
    const mevcut = birimGunleri.get(orgUnitId);
    if (mevcut) return mevcut;

    const gunler = expectedWorkDaysFrom(
      ctx.takvimIndeksi,
      orgUnitId,
      from,
      to,
      sirketTakvimi.holidays,
    );
    birimGunleri.set(orgUnitId, gunler);
    return gunler;
  };

  for (const kisi of kisiler) {
    const orgUnitId = overrides?.orgUnitByUser?.get(kisi.id) ?? kisi.orgUnitId;
    sonuc.set(
      kisi.id,
      hesaplaScoreInput({
        userId: kisi.id,
        anBasi,
        until,
        olcumAni,
        isGunleri: isGunleriniAl(orgUnitId),
        izinler: izinIndeksi.get(kisi.id) ?? [],
        kayitlar: kayitIndeksi.get(kisi.id) ?? [],
        kararlar: kararIndeksi.get(kisi.id) ?? [],
        maddeler: maddeIndeksi.get(kisi.id) ?? [],
        // Konuşmalar kişiye göre süzülüyor: kişi ya soran ya da yazan olmalı.
        konusmalar: konusmalar.filter(
          (k) => k.askerId === kisi.id || k.activity.authorId === kisi.id,
        ),
        takdirler: takdirIndeksi.get(kisi.id) ?? [],
        takvimAyari: ctx.takvimAyari,
        sirketTakvimi,
        onayEsigi: ctx.onayEsigi,
        cevapEsigi: ctx.cevapEsigi,
        maddeEsigi: ctx.maddeEsigi,
        appreciationPointsPer: ctx.appreciationPointsPer,
      }),
    );
  }

  return sonuc;
}
