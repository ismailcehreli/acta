import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { cancelActivity } from "@/server/activities/cancel";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SCORE_CALCULATORS } from "@/server/scoring/compute";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Closed periods are frozen and immutable.
// Once closed, changes in the current month (late approvals, cancellations, leave changes)
// must not mutate past period score cards.

const CLOSING_DATE = new Date(Date.UTC(2026, 7, 3, 6, 0, 0)); // August 3: closes July
const JULY = "2026-07-01";

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const unit = await createOrgUnit({
    name: "Workshop",
    parentId: root.id,
    requiresApproval: true,
  });
  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const manager = await createUser(unit.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });

  return { root, unit, generalManager, manager, artisan };
}

/** July total score as seen by a specific viewer. */
async function julyScoreTotal(viewerId: string, targetUserId: string): Promise<number | null> {
  const trend = await readScoreTrend(
    testDb,
    { id: viewerId, isSystemAdmin: false },
    targetUserId,
  );
  return trend.periods.find((p) => p.periodStart === JULY)?.total ?? null;
}

describe("closed period is frozen", () => {
  it("approvals granted after period end do not change past scores", async () => {
    const { manager, artisan } = await setupCompany();

    const activity = await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);
    expect(before).not.toBeNull();

    const decision = await approveActivity(
      testDb,
      manager.id,
      activity.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(decision.ok).toBe(true);

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });

  it("cancellations performed after period end do not mutate past score", async () => {
    const { manager, artisan } = await setupCompany();

    const activity = await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await createActivity(artisan, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);

    const cancelResult = await cancelActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity.id,
      "Duplicate entry found.",
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(cancelResult.ok).toBe(true);

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });

  it("retrospectively cancelled leave does not inflate denominator of closed period", async () => {
    const { manager, artisan } = await setupCompany();

    for (const day of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    const leave = await testDb.noActivityPeriod.create({
      data: {
        userId: artisan.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-10T00:00:00.000Z"),
        markedById: artisan.id,
      },
    });

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);

    await testDb.noActivityPeriod.update({
      where: { id: leave.id },
      data: {
        cancelledAt: new Date("2026-08-10T09:00:00.000Z"),
        cancelledById: artisan.id,
        cancellationReason: "Entered erroneously.",
      },
    });

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });

  it("official holidays added after period end do not change denominator", async () => {
    const { manager, artisan } = await setupCompany();

    for (const day of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);

    for (const day of [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]) {
      await testDb.holiday.create({
        data: {
          date: new Date(`${day}T00:00:00.000Z`),
          description: "Belatedly declared holiday",
        },
      });
    }

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });

  it("user promoted to manager later retains past period employee profile", async () => {
    const { manager, artisan } = await setupCompany();

    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await createActivity(artisan, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-16T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);

    await testDb.user.update({
      where: { id: artisan.id },
      data: { isUnitManager: true },
    });

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });

  it("changing weight settings does not recalculate past frozen periods", async () => {
    const { manager, artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);
    const before = await julyScoreTotal(manager.id, artisan.id);

    const saved = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "10",
      [SETTING_KEYS.scoringWeightAcceptance]: "60",
      [SETTING_KEYS.scoringWeightApproval]: "60",
      [SETTING_KEYS.scoringWeightFollowUp]: "30",
    });
    expect(saved.ok).toBe(true);

    expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
  });
});

describe("freezing preserves visibility integrity", () => {
  it("unseen activities do not factor into viewer score calculation", async () => {
    const { generalManager, manager, artisan } = await setupCompany();

    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    const ownScore = await julyScoreTotal(artisan.id, artisan.id);
    const gmViewedScore = await julyScoreTotal(generalManager.id, artisan.id);

    expect(ownScore).not.toBe(gmViewedScore);
  });

  it("legacy un-frozen periods are not rendered to any viewer", async () => {
    const { generalManager, artisan } = await setupCompany();

    await testDb.userScorePeriod.create({
      data: {
        userId: artisan.id,
        periodStart: new Date(`${JULY}T00:00:00.000Z`),
        regularity: 40,
        followUp: 30,
        total: 70,
        expectedDays: 22,
        writtenDays: 20,
      },
    });

    expect(await julyScoreTotal(artisan.id, artisan.id)).toBeNull();
    expect(await julyScoreTotal(generalManager.id, artisan.id)).toBeNull();
  });
});

describe("formula version is frozen", () => {
  it("new formula version does not alter V1 period score", async () => {
    const { manager, artisan } = await setupCompany();
    for (const day of ["2026-07-15", "2026-07-16"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, CLOSING_DATE, { formulaVersion: 1 });
    const before = await julyScoreTotal(manager.id, artisan.id);
    expect(before).not.toBeNull();

    const originalV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = () => ({
      regularity: 0,
      acceptance: null,
      approval: null,
      followUp: 0,
      total: 0,
    });

    try {
      expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
    } finally {
      SCORE_CALCULATORS[2] = originalV2;
    }
  });

  it("periods with unrecognized formula version are not displayed", async () => {
    const { manager, artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await closeScorePeriod(testDb, CLOSING_DATE);

    await testDb.$executeRaw`
      ALTER TABLE "UserScorePeriod" DISABLE TRIGGER "UserScorePeriod_frozen_immutable"`;
    await testDb.userScorePeriod.updateMany({
      where: { userId: artisan.id },
      data: { formulaVersion: 99 },
    });
    await testDb.$executeRaw`
      ALTER TABLE "UserScorePeriod" ENABLE TRIGGER "UserScorePeriod_frozen_immutable"`;

    expect(await julyScoreTotal(manager.id, artisan.id)).toBeNull();
    expect(await julyScoreTotal(artisan.id, artisan.id)).toBeNull();
  });

  it("when V2 produces different results, V1 period remains unaffected", async () => {
    const { manager, artisan } = await setupCompany();
    for (const day of ["2026-07-15", "2026-07-16"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, CLOSING_DATE, { formulaVersion: 1 });
    const before = await julyScoreTotal(manager.id, artisan.id);
    expect(before).not.toBeNull();

    const originalV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = (profile, input, weights) => {
      const v1 = SCORE_CALCULATORS[1]!(profile, input, weights);
      return { ...v1, regularity: 0, total: v1.total - v1.regularity };
    };

    try {
      const sample = {
        expectedDays: 20,
        writtenDays: 10,
        writtenCount: 10,
        approvedCount: 5,
        decidedCount: 0,
        decidedOnTimeCount: 0,
        followUpTotal: 0,
        followUpHandled: 0,
      };
      const weights = {
        regularity: 60,
        acceptance: 30,
        approval: 30,
        followUp: 10,
      };
      expect(SCORE_CALCULATORS[2]!("employee", sample, weights).total).not.toBe(
        SCORE_CALCULATORS[1]!("employee", sample, weights).total,
      );

      expect(await julyScoreTotal(manager.id, artisan.id)).toBe(before);
    } finally {
      SCORE_CALCULATORS[2] = originalV2;
    }
  });
});

describe("events after period end but before closing run are excluded", () => {
  const POST_PERIOD = new Date("2026-08-01T00:30:00.000Z");

  it("approvals granted after period end are not counted as accepted for that period", async () => {
    const { manager, artisan } = await setupCompany();

    const early = await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    const late = await createActivity(artisan, {
      activityDate: new Date("2026-07-16T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-16T09:00:00.000Z"),
    });

    await approveActivity(
      testDb,
      manager.id,
      early.id,
      new Date("2026-07-20T09:00:00.000Z"),
    );
    await approveActivity(testDb, manager.id, late.id, POST_PERIOD);

    await closeScorePeriod(testDb, CLOSING_DATE);

    const acceptedCount = await testDb.userScorePeriodFact.count({
      where: { userId: artisan.id, kind: "ACCEPTED" },
    });
    expect(acceptedCount).toBe(1);
  });

  it("cancellations performed after period end do not omit activity from period score", async () => {
    const { manager, artisan } = await setupCompany();
    const activity = await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await cancelActivity(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      activity.id,
      "Discovered after period ended.",
      POST_PERIOD,
    );

    await closeScorePeriod(testDb, CLOSING_DATE);

    const writtenCount = await testDb.userScorePeriodFact.count({
      where: { userId: artisan.id, kind: "WRITTEN" },
    });
    expect(writtenCount).toBe(1);
  });

  it("leaves cancelled after period end do not restore denominator days", async () => {
    const { manager, artisan } = await setupCompany();
    for (const day of ["2026-07-15", "2026-07-16", "2026-07-17"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    const leave = await testDb.noActivityPeriod.create({
      data: {
        userId: artisan.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-10T00:00:00.000Z"),
        markedById: artisan.id,
      },
    });

    await testDb.noActivityPeriod.update({
      where: { id: leave.id },
      data: {
        cancelledAt: POST_PERIOD,
        cancelledById: artisan.id,
        cancellationReason: "Entered erroneously.",
      },
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    const row = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: artisan.id },
    });
    expect(row.expectedDays).toBe(15);
    void manager;
  });
});

describe("facts set of closed period is immutable", () => {
  it("rejects insertion of new facts into a frozen period", async () => {
    const { artisan } = await setupCompany();
    const activity = await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: artisan.id,
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          activityId: activity.id,
          kind: "WRITTEN",
          happenedOn: new Date("2026-07-20T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_FROZEN/);
  });

  it("close period operation seals period and generates facts", async () => {
    const { artisan } = await setupCompany();
    for (const day of ["2026-07-15", "2026-07-16"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
      });
    }

    const result = await closeScorePeriod(testDb, CLOSING_DATE);
    expect(result.written).toBeGreaterThan(0);

    const row = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: artisan.id },
    });
    expect(row.frozen).toBe(true);
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: artisan.id } }),
    ).toBeGreaterThan(0);
  });
});
