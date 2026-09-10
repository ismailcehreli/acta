import type { ScoreInput, ScoreProfile, ScoreResult, ScoreWeights } from "./compute";

// Skor formülü **sürüm 1** — kendi ayakları üzerinde duran, değişmez modül
// (denetim 25.08.2026, P8-R2-4).
//
// Önce `SCORE_CALCULATORS[1]` ayrı bir ad taşıyordu ama gövdesi ortak
// `profileWeights` ve `puan` yardımcılarını çağırıyordu. Yeni bir formül için
// o ortaklardan biri değiştirildiğinde V1 dönemleri de yeniden yorumlanırdı:
// sürüm kolonu vardı ama korumak için eklendiği davranışı garanti etmiyordu.
//
// Bu dosyadaki her şey V1'e özeldir: profil dağılımı, boş payda davranışı,
// sınırlar ve yuvarlama. **Değiştirilmez.** Formül değişecekse yeni bir
// sürüm modülü yazılır ve `SCORE_CALCULATORS`a eklenir; kapanmış dönemler
// yazıldıkları sürümle okunmaya devam eder.
//
// Altın sonuçları `tests/scoring/formul-v1.test.ts` içinde sabitlenmiştir:
// buradaki bir davranış değişirse o test kırılır.

/**
 * Profile göre ağırlık dağılımı — V1.
 *
 * Bazı boyutlar bazı kişilerde tanımı gereği sabit olduğu için profil ayrımı
 * var: onaya tabi olmayan birimde kabul oranı hep %100 olurdu, yöneticide de
 * öyle. Ölçmeyen bir boyut ağırlığını boşa harcamasın diye ağırlık ya
 * düzenliliğe ekleniyor ya da onay süresine geçiyor (tasarım satır 686).
 */
function v1ProfilAgirliklari(
  profile: ScoreProfile,
  weights: ScoreWeights,
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

/**
 * Oran → puan — V1.
 *
 * Payda sıfırsa boyut **cezalandırmıyor**, tam sayılıyor: bütün dönem izinli
 * olan biri düzenlilikten sıfır almamalı — yazmadığı için değil, beklenmediği
 * için yok. Aynısı "hiç karar düşmemiş yönetici" için de geçerli.
 */
function v1Puan(pay: number, payda: number, agirlik: number): number {
  if (agirlik === 0) return 0;
  if (payda <= 0) return agirlik;

  const oran = Math.min(1, Math.max(0, pay / payda));
  return Math.round(agirlik * oran);
}

/** Sürüm 1 hesabı. Bu gövde **değiştirilmez**. */
export function computeScoreV1(
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights,
): ScoreResult {
  const w = v1ProfilAgirliklari(profile, weights);

  const regularity = v1Puan(input.writtenDays, input.expectedDays, w.regularity);
  const followUp = v1Puan(input.followUpHandled, input.followUpTotal, w.followUp);

  const acceptance =
    w.acceptance === 0
      ? null
      : v1Puan(input.approvedCount, input.writtenCount, w.acceptance);

  const approval =
    w.approval === 0
      ? null
      : v1Puan(input.decidedOnTimeCount, input.decidedCount, w.approval);

  return {
    regularity,
    acceptance,
    approval,
    followUp,
    total: regularity + (acceptance ?? 0) + (approval ?? 0) + followUp,
  };
}
