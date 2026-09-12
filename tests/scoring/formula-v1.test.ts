import { describe, expect, it } from "vitest";

import { computeScoreV1 } from "@/server/scoring/formula-v1";
import type { ScoreInput, ScoreWeights } from "@/server/scoring/compute";

// Formula Version 1 golden results (audit 25.08.2026, P8-R2-4).
//
// V1 previously called shared `profileWeights` and `score` helpers: if one of those
// shared helpers changed for a new formula, V1 periods would be re-interpreted.
//
// This file locks V1 with exact numbers. If profile distribution, empty denominator
// behavior, clamping, or rounding changes, a test here fails.
// When broken, the action is NOT to update this test: new behavior belongs to a new version.

const WEIGHTS: ScoreWeights = {
  regularity: 60,
  acceptance: 30,
  approval: 30,
  followUp: 10,
};

function sampleInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    expectedDays: 20,
    writtenDays: 10,
    writtenCount: 10,
    approvedCount: 5,
    decidedCount: 4,
    decidedOnTimeCount: 3,
    followUpTotal: 4,
    followUpHandled: 2,
    ...overrides,
  };
}

describe("formula V1 — golden results", () => {
  it("employee profile: has acceptance rate, no approval duration", () => {
    // regularity 60*(10/20)=30, acceptance 30*(5/10)=15, followUp 10*(2/4)=5
    expect(computeScoreV1("employee", sampleInput(), WEIGHTS)).toEqual({
      regularity: 30,
      acceptance: 15,
      approval: null,
      followUp: 5,
      total: 50,
    });
  });

  it("unapproved profile: acceptance weight is added to regularity", () => {
    // regularity (60+30)*(10/20)=45, no acceptance, followUp 5
    expect(computeScoreV1("unapproved", sampleInput(), WEIGHTS)).toEqual({
      regularity: 45,
      acceptance: null,
      approval: null,
      followUp: 5,
      total: 50,
    });
  });

  it("manager profile: approval duration instead of acceptance", () => {
    // regularity 30, approval 30*(3/4)=23 (rounded), followUp 5
    expect(computeScoreV1("manager", sampleInput(), WEIGHTS)).toEqual({
      regularity: 30,
      acceptance: null,
      approval: 23,
      followUp: 5,
      total: 58,
    });
  });

  it("empty denominator does not penalize, awards full score", () => {
    // Entire period on leave: missing because not expected, not because omitted.
    expect(
      computeScoreV1(
        "employee",
        sampleInput({
          expectedDays: 0,
          writtenDays: 0,
          writtenCount: 0,
          approvedCount: 0,
          followUpTotal: 0,
          followUpHandled: 0,
        }),
        WEIGHTS,
      ),
    ).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: null,
      followUp: 10,
      total: 100,
    });
  });

  it("ratio clamped to 1 if numerator exceeds denominator", () => {
    expect(
      computeScoreV1(
        "employee",
        sampleInput({ writtenDays: 40, expectedDays: 20 }),
        WEIGHTS,
      ).regularity,
    ).toBe(60);
  });

  it("rounds to nearest integer", () => {
    // 60 * (1/3) = 20; 30 * (1/3) = 10; 10 * (1/3) = 3.33 -> 3
    expect(
      computeScoreV1(
        "employee",
        sampleInput({
          expectedDays: 3,
          writtenDays: 1,
          writtenCount: 3,
          approvedCount: 1,
          followUpTotal: 3,
          followUpHandled: 1,
        }),
        WEIGHTS,
      ),
    ).toEqual({
      regularity: 20,
      acceptance: 10,
      approval: null,
      followUp: 3,
      total: 33,
    });
  });
});
