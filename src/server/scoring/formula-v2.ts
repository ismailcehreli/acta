import type { ScoreInput, ScoreProfile, ScoreResult, ScoreWeights } from "./compute";

// Skor formülü sürüm 2. Temel üç skor bölümü V1 ile aynı hesaplanır; geçerli
// takdirler, ayardaki puan kadar toplamın üzerine eklenir.
//
// Bu modülün kendi hesap yardımcıları vardır. V1 dönemleri hiçbir zaman yeni
// bir davranışla yeniden yorumlanmaz; yeni formül sürümü yeni dönemlerde
// kullanılır.

function profilAgirliklari(
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

function puan(pay: number, payda: number, agirlik: number): number {
  if (agirlik === 0) return 0;
  if (payda <= 0) return agirlik;

  const oran = Math.min(1, Math.max(0, pay / payda));
  return Math.round(agirlik * oran);
}

export function computeScoreV2(
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights,
): ScoreResult {
  const w = profilAgirliklari(profile, weights);

  const regularity = puan(input.writtenDays, input.expectedDays, w.regularity);
  const followUp = puan(input.followUpHandled, input.followUpTotal, w.followUp);
  const acceptance =
    w.acceptance === 0
      ? null
      : puan(input.approvedCount, input.writtenCount, w.acceptance);
  const approval =
    w.approval === 0
      ? null
      : puan(input.decidedOnTimeCount, input.decidedCount, w.approval);

  const baseTotal =
    regularity + (acceptance ?? 0) + (approval ?? 0) + followUp;
  const appreciationCount = Math.max(0, Math.trunc(input.appreciationCount ?? 0));
  const appreciationPointsPer = Math.max(
    0,
    Math.trunc(input.appreciationPointsPer ?? 0),
  );
  const appreciationPoints = appreciationCount * appreciationPointsPer;

  return {
    regularity,
    acceptance,
    approval,
    followUp,
    baseTotal,
    appreciationCount,
    appreciationPoints,
    appreciationPointsPer,
    total: baseTotal + appreciationPoints,
  };
}
