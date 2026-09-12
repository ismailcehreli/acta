import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Rejection tests for freezing constraints (audit 2026-08-23, P3-R2-4).
//
// Two rules reside in the database:
//
//   · `UserScorePeriod_frozen_formula` — frozen period must carry profile and four weights.
//     Otherwise the row says "frozen" but which formula to read with is unknown and read
//     would silently fall back to today's settings.
//   · `UserScorePeriodFact_requires_frozen` — facts can only be written to a draft period.
//     Because it is a cross-table rule, it cannot be expressed via CHECK, so it is enforced via trigger.
//
// Tests bypass the application layer: the value of the constraint lies in remaining valid
// even when the writing code is disabled.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({ name: "Molding", parentId: root.id });
  const author = await createUser(unit.id, { fullName: "Lead Craftsman" });
  const activity = await createActivity(author, {
    activityDate: new Date("2026-07-15T00:00:00.000Z"),
  });
  return { author, activity };
}

const JULY = new Date("2026-07-01T00:00:00.000Z");

function buildPeriod(userId: string, extra: Record<string, unknown>) {
  return {
    userId,
    periodStart: JULY,
    regularity: 40,
    followUp: 30,
    total: 70,
    expectedDays: 22,
    writtenDays: 20,
    ...extra,
  };
}

describe("frozen period must carry formula", () => {
  it("rejects frozen period without profile", async () => {
    const { author } = await setup();

    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriod(author.id, {
          frozen: true,
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          weightFollowUp: 30,
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("rejects frozen period with missing weight", async () => {
    const { author } = await setup();

    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriod(author.id, {
          frozen: true,
          profile: "employee",
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          // `weightFollowUp` missing
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("cannot write formula to an unfrozen period", async () => {
    const { author } = await setup();

    // Reverse direction is also closed: old model row carrying formula would introduce ambiguity.
    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriod(author.id, { frozen: false, profile: "employee" }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("rejects frozen period without formula version", async () => {
    const { author } = await setup();

    // Formula version is part of the seal (P8-5): versionless row would fall back to today's algorithm.
    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriod(author.id, {
          frozen: true,
          profile: "employee",
          weightRegularity: 40,
          weightAcceptance: 30,
          weightApproval: 0,
          weightFollowUp: 30,
        }),
      }),
    ).rejects.toThrow(/UserScorePeriod_frozen_formula/);
  });

  it("accepts completely frozen period", async () => {
    const { author } = await setup();

    const created = await testDb.userScorePeriod.create({
      data: buildPeriod(author.id, {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      }),
    });

    expect(created.frozen).toBe(true);
  });
});

describe("facts can only be added to draft periods and frozen periods are immutable", () => {
  async function createPeriod(userId: string, frozen: boolean) {
    return testDb.userScorePeriod.create({
      data: buildPeriod(
        userId,
        frozen
          ? {
              frozen: true,
              profile: "employee",
              weightRegularity: 40,
              weightAcceptance: 30,
              weightApproval: 0,
              weightFollowUp: 30,
              formulaVersion: 1,
            }
          : { frozen: false },
      ),
    });
  }

  // Direction reversed (audit 2026-08-25, P8-R2-1):
  // Periods are state-transitioned: open draft period (`frozen = false`), write facts, seal period.
  // After sealing, the set cannot be modified.
  /** Actual closing sequence: create draft, write fact, seal period. */
  async function frozenPeriodAndFact(userId: string, activityId: string) {
    await createPeriod(userId, false);
    const fact = await testDb.userScorePeriodFact.create({
      data: {
        userId,
        periodStart: JULY,
        activityId,
        kind: "WRITTEN",
        happenedOn: new Date("2026-07-15T00:00:00.000Z"),
      },
    });
    await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: { userId, periodStart: JULY, revisionNo: 1 },
      },
      data: {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });
    return fact;
  }

  it("cannot add fact to a frozen period", async () => {
    const { author, activity } = await setup();
    await createPeriod(author.id, true);

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: author.id,
          periodStart: JULY,
          activityId: activity.id,
          kind: "WRITTEN",
          happenedOn: new Date("2026-07-15T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_FROZEN/);
  });

  it("writes fact to draft period", async () => {
    const { author, activity } = await setup();
    await createPeriod(author.id, false);

    const fact = await testDb.userScorePeriodFact.create({
      data: {
        userId: author.id,
        periodStart: JULY,
        activityId: activity.id,
        kind: "WRITTEN",
        happenedOn: new Date("2026-07-15T00:00:00.000Z"),
      },
    });

    expect(fact.onTime).toBe(true);
  });

  it("calculation timestamp is also sealed", async () => {
    const { author } = await setup();
    await createPeriod(author.id, true);

    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: author.id,
            periodStart: JULY,
            revisionNo: 1,
          },
        },
        data: { computedAt: new Date("2027-01-01T00:00:00.000Z") },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("fact content cannot be updated", async () => {
    const { author, activity } = await setup();
    const fact = await frozenPeriodAndFact(author.id, activity.id);

    await expect(
      testDb.userScorePeriodFact.update({
        where: { id: fact.id },
        data: { onTime: false },
      }),
    ).rejects.toThrow(/SCORE_FACT_IMMUTABLE/);
  });

  it("fact cannot be deleted", async () => {
    const { author, activity } = await setup();
    const fact = await frozenPeriodAndFact(author.id, activity.id);

    await expect(
      testDb.userScorePeriodFact.delete({ where: { id: fact.id } }),
    ).rejects.toThrow(/SCORE_FACT_IMMUTABLE/);
  });

  it("period cannot be unsealed later: row carrying facts cannot be unfrozen", async () => {
    const { author, activity } = await setup();
    await frozenPeriodAndFact(author.id, activity.id);

    // Compound unfreeze: clearing frozen flag and formula columns together.
    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: author.id,
            periodStart: JULY,
            revisionNo: 1,
          },
        },
        data: {
          frozen: false,
          profile: null,
          weightRegularity: null,
          weightAcceptance: null,
          weightApproval: null,
          weightFollowUp: null,
        },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("cannot change denominator or score on a frozen period", async () => {
    const { author } = await setup();
    await createPeriod(author.id, true);

    await expect(
      testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: author.id,
            periodStart: JULY,
            revisionNo: 1,
          },
        },
        data: { expectedDays: 1, total: 100 },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("frozen period cannot be deleted", async () => {
    const { author } = await setup();
    await createPeriod(author.id, true);

    await expect(
      testDb.userScorePeriod.delete({
        where: {
          userId_periodStart_revisionNo: {
            userId: author.id,
            periodStart: JULY,
            revisionNo: 1,
          },
        },
      }),
    ).rejects.toThrow(/FROZEN_PERIOD_IMMUTABLE/);
  });

  it("unfrozen period can still be corrected", async () => {
    const { author } = await setup();
    await createPeriod(author.id, false);

    // Seal only applies once frozen; correcting draft rows is allowed.
    const updated = await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: {
          userId: author.id,
          periodStart: JULY,
          revisionNo: 1,
        },
      },
      data: { total: 71 },
    });
    expect(updated.total).toBe(71);
  });
});
