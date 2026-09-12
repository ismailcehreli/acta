import { computeScoreV1 } from "./formula-v1";
import { computeScoreV2 } from "./formula-v2";

// Period-based score calculation (Task 11.10, design Package I).
//
// Three principles: periodic not cumulative; days not count; decision quality not approval count.
//
// Base score is calculated out of 100. Appreciation contribution can be added on top of this
// to make valuable activities visible in the overall total.

export type ScoreProfile = "employee" | "unapproved" | "manager";

export interface ScoreWeights {
  regularity: number;
  acceptance: number;
  approval: number;
  followUp: number;
}

/**
 * Default values for the four score weights from settings (design lines 672-686).
 *
 * These are defaults, not hard constraints: real values come from `SystemSetting`
 * and are read with `readScoreWeights`. This object exists for pure calculation
 * tests where settings are not read.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  regularity: 60,
  acceptance: 30,
  approval: 30,
  followUp: 10,
};

/**
 * Base score weight distribution per profile. All three sum to 100 —
 * cross-validation enforces this at the save boundary (`SETTING_SUM_RULES`).
 *
 * Profiles exist because some dimensions are definitionally fixed for certain roles:
 *   - In units not requiring approval, records are created directly as APPROVED;
 *     acceptance rate would always be 100%. An unmeasured dimension wastes its weight,
 *     so its weight is added to regularity (design line 686).
 *   - Managers are not subject to approval (§18.2). Instead "approval duration" replaces it —
 *     in how many work days did they decide on activities assigned to them.
 *     Rejection is also a decision and awards the same score.
 */
export function profileWeights(
  profile: ScoreProfile,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
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
  /** How many work days were expected in period (leaves and holidays deducted). */
  expectedDays: number;
  /** On how many days were activities logged. Five records on one day count as one day. */
  writtenDays: number;
  /** Number of activities written in period; denominator for acceptance rate. */
  writtenCount: number;
  approvedCount: number;
  /** Number of records decided by manager (including rejections). */
  decidedCount: number;
  /** How many of those were decided within the threshold. */
  decidedOnTimeCount: number;
  /** Follow-up items responsible for and questions needing answers in period. */
  followUpTotal: number;
  /** How many of those were closed or answered. */
  followUpHandled: number;
  /** Valid appreciation count granted to approved activities in period. */
  appreciationCount?: number;
  /** Points per appreciation active during that period. */
  appreciationPointsPer?: number;
}

export interface ScoreResult {
  regularity: number;
  acceptance: number | null;
  approval: number | null;
  followUp: number;
  total: number;
  /** Sum of the three base dimensions before appreciation is added. */
  baseTotal?: number;
  /** Number of appreciations contributing to score. */
  appreciationCount?: number;
  /** Total points contributed by appreciations. */
  appreciationPoints?: number;
  /** Points per appreciation used in calculation. */
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
 * Currently active formula version (audit 25.08.2026, P8-5).
 *
 * Weights were frozen but the algorithm must also be frozen.
 * The period row carries which version it closed with, and reads select
 * that version's calculator.
 */
export const SCORE_FORMULA_VERSION = 2;

/**
 * Calculators by formula version.
 *
 * When the formula changes, a new version is added rather than modifying existing ones:
 * past periods continue to be read with their respective calculator.
 */
export const SCORE_CALCULATORS: Record<
  number,
  (profile: ScoreProfile, input: ScoreInput, weights: ScoreWeights) => ScoreResult
> = {
  // V1 resides in its own module with its own helpers (audit 25.08.2026, P8-R2-4).
  1: computeScoreV1,
  // V2 preserves the three base sections of V1 and adds appreciation points to the total.
  2: computeScoreV2,
};

export function computeScore(
  profile: ScoreProfile,
  input: ScoreInput,
  /** Four weights from settings; if omitted, defaults are used. */
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreResult {
  return computeScoreByVersion(SCORE_FORMULA_VERSION, profile, input, weights);
}

/** Executes the specified version; passes the same value as the label written at closing. */
export function computeScoreByVersion(
  version: number,
  profile: ScoreProfile,
  input: ScoreInput,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreResult {
  const calculator = SCORE_CALCULATORS[version];
  if (!calculator) {
    throw new Error(`Unsupported score formula: ${version}`);
  }

  return calculator(profile, input, weights);
}
