import type { ScoreInput, ScoreProfile, ScoreResult, ScoreWeights } from "./compute";


// (audit 2026-08-25, P8-R2-4).
//




//




//




function v1ProfileWeights(
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


function v1Score(share: number, denominator: number, weight: number): number {
  if (weight === 0) return 0;
  if (denominator <= 0) return weight;

  const ratio = Math.min(1, Math.max(0, share / denominator));
  return Math.round(weight * ratio);
}


export function computeScoreV1(
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights,
): ScoreResult {
  const w = v1ProfileWeights(profile, weights);

  const regularity = v1Score(input.writtenDays, input.expectedDays, w.regularity);
  const followUp = v1Score(input.followUpHandled, input.followUpTotal, w.followUp);

  const acceptance =
    w.acceptance === 0
      ? null
      : v1Score(input.approvedCount, input.writtenCount, w.acceptance);

  const approval =
    w.approval === 0
      ? null
      : v1Score(input.decidedOnTimeCount, input.decidedCount, w.approval);

  return {
    regularity,
    acceptance,
    approval,
    followUp,
    total: regularity + (acceptance ?? 0) + (approval ?? 0) + followUp,
  };
}
