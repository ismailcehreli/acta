import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCORE_WEIGHTS,
  computeScore,
  profileWeights,
  resolveScoreProfile,
} from "@/server/scoring/compute";

const SCORE_PROFILES = {
  employee: profileWeights("employee"),
  unapproved: profileWeights("unapproved"),
  manager: profileWeights("manager"),
};

// Periodic score calculation (Task 11.10, design Package I).
//
// Base score is calculated out of 100; appreciation points can be added on top.
// Three profiles exist because some dimensions are definitionally fixed for certain roles:
// in units not requiring approval, acceptance rate is always 100%, and managers are not
// subject to approval.

const EMPTY_INPUT = {
  expectedDays: 0,
  writtenDays: 0,
  writtenCount: 0,
  approvedCount: 0,
  decidedCount: 0,
  decidedOnTimeCount: 0,
  followUpTotal: 0,
  followUpHandled: 0,
};

describe("profile selection", () => {
  it("employee requiring approval", () => {
    expect(resolveScoreProfile({ isUnitManager: false, requiresApproval: true })).toBe("employee");
  });

  it("employee not requiring approval", () => {
    expect(resolveScoreProfile({ isUnitManager: false, requiresApproval: false })).toBe("unapproved");
  });

  it("manager gets manager profile even if unit requires approval", () => {
    expect(resolveScoreProfile({ isUnitManager: true, requiresApproval: true })).toBe("manager");
  });
});

describe("weight sum is 100 for each profile", () => {
  it("all three profiles have the same cap", () => {
    for (const [profileName, weights] of Object.entries(SCORE_PROFILES)) {
      expect(weights.regularity + weights.acceptance + weights.approval + weights.followUp, profileName).toBe(100);
    }
  });

  it("weight distribution from settings alters the calculation", () => {
    const weights = { regularity: 30, acceptance: 60, approval: 60, followUp: 10 };
    const input = {
      ...EMPTY_INPUT,
      expectedDays: 10,
      writtenDays: 5,
      writtenCount: 4,
      approvedCount: 4,
    };

    const defaultScore = computeScore("employee", input);
    const configuredScore = computeScore("employee", input, weights);

    // Regularity half (50%), acceptance rate full (100%): total increases when weight shifts to acceptance.
    // Default: regularity 60*0.5 = 30, acceptance 30, followUp 10.
    expect(defaultScore.total).toBe(30 + 30 + 10);
    // Configured: regularity 30*0.5 = 15, acceptance 60, followUp 10.
    expect(configuredScore.total).toBe(15 + 60 + 10);
  });

  it("regularity for unapproved profile is sum of regularity and acceptance weights", () => {
    const weights = { regularity: 50, acceptance: 40, approval: 40, followUp: 10 };

    expect(profileWeights("unapproved", weights).regularity).toBe(90);
    expect(profileWeights("unapproved", DEFAULT_SCORE_WEIGHTS).regularity).toBe(90);
  });
});

describe("regularity", () => {
  it("scores full points when writing on all expected days", () => {
    const score = computeScore("employee", { ...EMPTY_INPUT, expectedDays: 20, writtenDays: 20 });
    expect(score.regularity).toBe(SCORE_PROFILES.employee.regularity);
  });

  it("five records on the same day count as one day", () => {
    const oneActivityScore = computeScore("employee", {
      ...EMPTY_INPUT, expectedDays: 20, writtenDays: 10, writtenCount: 10, approvedCount: 10,
    });
    const fiveActivitiesScore = computeScore("employee", {
      ...EMPTY_INPUT, expectedDays: 20, writtenDays: 10, writtenCount: 50, approvedCount: 50,
    });
    expect(fiveActivitiesScore.regularity).toBe(oneActivityScore.regularity);
  });

  it("regularity is full if there are no expected days", () => {
    expect(computeScore("employee", EMPTY_INPUT).regularity).toBe(
      SCORE_PROFILES.employee.regularity,
    );
  });

  it("regularity is zero if no activities were logged", () => {
    const score = computeScore("employee", { ...EMPTY_INPUT, expectedDays: 20 });
    expect(score.regularity).toBe(0);
    expect(score.total).toBeLessThan(100);
  });
});

describe("acceptance rate", () => {
  it("computed for employee requiring approval", () => {
    const score = computeScore("employee", {
      ...EMPTY_INPUT, expectedDays: 10, writtenDays: 10, writtenCount: 10, approvedCount: 5,
    });
    expect(score.acceptance).toBe(Math.round(SCORE_PROFILES.employee.acceptance * 0.5));
  });

  it("remains null for profile not requiring approval", () => {
    const score = computeScore("unapproved", {
      ...EMPTY_INPUT, expectedDays: 10, writtenDays: 10, writtenCount: 10, approvedCount: 10,
    });
    expect(score.acceptance).toBeNull();
  });
});

describe("manager approval duration", () => {
  it("timely decisions yield points", () => {
    const score = computeScore("manager", {
      ...EMPTY_INPUT, expectedDays: 10, writtenDays: 10, decidedCount: 10, decidedOnTimeCount: 10,
    });
    expect(score.approval).toBe(SCORE_PROFILES.manager.approval);
  });

  it("dimension does not penalize if no decisions were assigned", () => {
    const score = computeScore("manager", { ...EMPTY_INPUT, expectedDays: 10, writtenDays: 10 });
    expect(score.approval).toBe(SCORE_PROFILES.manager.approval);
  });

  it("approval dimension is null for employee", () => {
    expect(computeScore("employee", EMPTY_INPUT).approval).toBeNull();
  });
});

describe("total", () => {
  it("all three profiles yield 100 for full performance", () => {
    for (const profile of ["employee", "unapproved", "manager"] as const) {
      const score = computeScore(profile, {
        expectedDays: 20, writtenDays: 20, writtenCount: 20, approvedCount: 20,
        decidedCount: 5, decidedOnTimeCount: 5, followUpTotal: 3, followUpHandled: 3,
      });
      expect(score.total, profile).toBe(100);
    }
  });

  it("appreciation points added on top of base score", () => {
    const score = computeScore("employee", {
      ...EMPTY_INPUT,
      expectedDays: 20,
      writtenDays: 20,
      writtenCount: 20,
      approvedCount: 20,
      appreciationCount: 4,
      appreciationPointsPer: 2,
    });

    expect(score.baseTotal).toBe(100);
    expect(score.appreciationCount).toBe(4);
    expect(score.appreciationPoints).toBe(8);
    expect(score.total).toBe(108);
  });

  it("base score does not change if points per appreciation is zero", () => {
    const score = computeScore("employee", {
      ...EMPTY_INPUT,
      expectedDays: 20,
      writtenDays: 20,
      writtenCount: 20,
      approvedCount: 20,
      appreciationCount: 4,
      appreciationPointsPer: 0,
    });

    expect(score.appreciationCount).toBe(4);
    expect(score.appreciationPoints).toBe(0);
    expect(score.total).toBe(100);
  });
});
