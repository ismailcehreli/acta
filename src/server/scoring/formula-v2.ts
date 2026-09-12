import type { ScoreInput, ScoreProfile, ScoreResult, ScoreWeights } from "./compute";



//




function profileWeights(
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

function score(share: number, denominator: number, weight: number): number {
  if (weight === 0) return 0;
  if (denominator <= 0) return weight;

  const ratio = Math.min(1, Math.max(0, share / denominator));
  return Math.round(weight * ratio);
}

export function computeScoreV2(
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights,
): ScoreResult {
  const w = profileWeights(profile, weights);

  const regularity = score(input.writtenDays, input.expectedDays, w.regularity);
  const followUp = score(input.followUpHandled, input.followUpTotal, w.followUp);
  const acceptance =
    w.acceptance === 0
      ? null
      : score(input.approvedCount, input.writtenCount, w.acceptance);
  const approval =
    w.approval === 0
      ? null
      : score(input.decidedOnTimeCount, input.decidedCount, w.approval);

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
