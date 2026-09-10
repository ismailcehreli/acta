import { computeScoreV1 } from "./formula-v1";
import { computeScoreV2 } from "./formula-v2";

// Dönemsel skor hesabı (Görev 11.10, tasarım Paket I).
//
// **Üç ilke:** kümülatif değil dönemsel · sayı değil gün · onay sayısı değil
// karar kalitesi.
//
// İster belgesi §3.2'deki formül olduğu gibi uygulanmadı; beş kusuru tasarım
// belgesinde yazılı. En ciddi ikisi: yöneticiye onay başına puan vermek onay
// mekanizmasının işini tersine çeviriyordu, ve "genel sıralama" belgenin
// kendi §5.1'ini deliyordu.
//
// Temel skor 100 üzerinden hesaplanır. Takdir katkısı, değerli faaliyetlerin
// genel toplamda ayrıca görünmesini sağlamak için bunun üzerine eklenebilir.

export type ScoreProfile = "employee" | "unapproved" | "manager";

export interface ScoreWeights {
  regularity: number;
  acceptance: number;
  approval: number;
  followUp: number;
}

/**
 * Ayarlardaki dört ağırlığın varsayılanı (tasarım satır 672-686).
 *
 * Bunlar **varsayılan**dır, kural değil: gerçek değerler `SystemSetting`ten
 * gelir ve `readScoreWeights` ile okunur. Buradaki nesne yalnız ayar
 * okunamayan saf hesap testleri için duruyor.
 */
export const VARSAYILAN_AGIRLIKLAR: ScoreWeights = {
  regularity: 60,
  acceptance: 30,
  approval: 30,
  followUp: 10,
};

/**
 * Profil başına temel skor ağırlık dağılımı. Üçünün de toplamı 100 — çapraz doğrulama
 * bunu kaydetme sınırında zorluyor (`SETTING_SUM_RULES`).
 *
 * Bazı boyutlar bazı kişilerde **tanımı gereği sabit** olduğu için profil
 * ayrımı var:
 *
 *   · Onaya tabi olmayan birimde kayıt doğrudan `APPROVED` doğar; kabul
 *     oranı hep %100 olurdu. Ölçmeyen bir boyut ağırlığını boşa harcar, o
 *     yüzden ağırlığı düzenliliğe **ekleniyor** — ayrı bir ayar değil,
 *     türetilmiş değer (tasarım satır 686).
 *   · Yöneticiler onaya tabi değildir (§18.2); aynı sorun. Yerine "onay
 *     süresi" geçiyor — kendisine düşen kaydı kaç iş gününde karara bağladı.
 *     **Ret de karardır ve aynı puanı getirir.**
 */
export function profileWeights(
  profile: ScoreProfile,
  weights: ScoreWeights = VARSAYILAN_AGIRLIKLAR,
): ScoreWeights {
  if (profile === "unapproved") {
    return {
      regularity: weights.regularity + weights.acceptance,
      acceptance: 0,
      approval: 0,
      followUp: weights.followUp,
    };
  }

  if (profile === "manager") {
    return {
      regularity: weights.regularity,
      acceptance: 0,
      approval: weights.approval,
      followUp: weights.followUp,
    };
  }

  return {
    regularity: weights.regularity,
    acceptance: weights.acceptance,
    approval: 0,
    followUp: weights.followUp,
  };
}

export interface ScoreInput {
  /** Dönemde kaç iş günü bekleniyordu (izin ve tatil düşülmüş). */
  expectedDays: number;
  /** Kaç **günde** kayıt girildi. Bir günde beş kayıt bir gün sayılır. */
  writtenDays: number;
  /** Dönemde yazılan kayıt sayısı; kabul oranının paydası. */
  writtenCount: number;
  approvedCount: number;
  /** Yöneticinin karara bağladığı kayıt sayısı (ret dahil). */
  decidedCount: number;
  /** Bunların kaçı eşik içinde karara bağlandı. */
  decidedOnTimeCount: number;
  /** Dönemde sorumlu olduğu takip maddesi ve cevaplaması gereken soru. */
  followUpTotal: number;
  /** Bunların kaçını kapattı ya da cevapladı. */
  followUpHandled: number;
  /** Dönemde onaylanmış faaliyetlere verilen geçerli takdir sayısı. */
  appreciationCount?: number;
  /** O dönemde geçerli olan takdir başına puan. */
  appreciationPointsPer?: number;
}

export interface ScoreResult {
  regularity: number;
  acceptance: number | null;
  approval: number | null;
  followUp: number;
  total: number;
  /** Takdir eklenmeden önceki üç temel bölümün toplamı. */
  baseTotal?: number;
  /** Skora katkı sağlayan takdir sayısı. */
  appreciationCount?: number;
  /** Takdirlerin toplam puan katkısı. */
  appreciationPoints?: number;
  /** Hesapta kullanılan takdir başına puan. */
  appreciationPointsPer?: number;
}

export function resolveScoreProfile(person: {
  isUnitManager: boolean;
  requiresApproval: boolean;
}): ScoreProfile {
  if (person.isUnitManager) return "manager";
  return person.requiresApproval ? "employee" : "unapproved";
}

/**
 * Yürürlükteki formül sürümü (denetim 25.08.2026, P8-5).
 *
 * Ağırlıkları donduruyorduk ama **algoritmayı** değil. Yuvarlama, boş payda
 * davranışı, boyut tanımı ya da profil eşlemesi ileride değişirse kişinin
 * kendi gördüğü saklanmış `total` aynı kalır, yöneticisinin gördüğü aynı
 * dönem ise yeni algoritmayla hesaplanıp **değişirdi**. Paket tam olarak
 * "aynı tarihçe farklı günlerde farklı toplam vermesin" diye yazıldı;
 * normal bir formül düzeltmesi bunu sessizce bozardı.
 *
 * Dönem satırı hangi sürümle kapandığını taşıyor ve okuma o sürümün
 * hesaplayıcısını seçiyor.
 */
export const SCORE_FORMULA_VERSION = 2;

/**
 * Sürüme göre hesaplayıcılar.
 *
 * Formül değiştiğinde **yeni bir sürüm eklenir**, mevcut olan
 * değiştirilmez: eski dönemler eski hesaplayıcıyla okunmaya devam eder.
 */
export const SCORE_CALCULATORS: Record<
  number,
  (profile: ScoreProfile, input: ScoreInput, weights: ScoreWeights) => ScoreResult
> = {
  // V1 **kendi modülünde** ve kendi yardımcılarıyla duruyor
  // (denetim 25.08.2026, P8-R2-4): buradaki ortak `profileWeights` ve
  // `puan` değişirse V1 dönemleri de yeniden yorumlanırdı.
  1: computeScoreV1,
  // V2, V1'in üç temel bölümünü korur ve takdir katkısını toplamın üzerine
  // ekler. V1'e dokunulmaz; kapanmış eski dönemler aynı kalır.
  2: computeScoreV2,
};

export function computeScore(
  profile: ScoreProfile,
  input: ScoreInput,
  /** Ayarlardan gelen dört ağırlık; verilmezse tasarımın varsayılanları. */
  weights: ScoreWeights = VARSAYILAN_AGIRLIKLAR,
): ScoreResult {
  return computeScoreByVersion(SCORE_FORMULA_VERSION, profile, input, weights);
}

/** Seçilen sürümü çalıştırır; kapanış yazdığı etiketle aynı değeri geçirir. */
export function computeScoreByVersion(
  version: number,
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights = VARSAYILAN_AGIRLIKLAR,
): ScoreResult {
  const hesaplayici = SCORE_CALCULATORS[version];
  if (!hesaplayici) {
    throw new Error(`Desteklenmeyen skor formülü: ${version}`);
  }

  return hesaplayici(profile, input, weights);
}
