import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Period closing and score trend analysis.
// Historic period scores are retained to calculate trend lines and detect consecutive score declines.

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const manager = await createUser(unit.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });
  return { artisan, manager };
}

function periodCloseTimestamp(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 3, 6, 0, 0));
}

describe("period close", () => {
  it("persists closed period score to database ledger", async () => {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    const result = await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));

    expect(result.written).toBe(2);
    const record = await testDb.userScorePeriod.findFirst({
      where: { userId: artisan.id },
    });
    expect(record?.periodStart.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(record?.writtenDays).toBe(1);
    expect(record?.expectedDays).toBeGreaterThan(0);
  });

  it("does not write the same period twice (idempotent)", async () => {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));
    const second = await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));

    expect(second.written).toBe(0);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: artisan.id } }),
    ).toBe(1);
  });

  it("does not write when scoring system is disabled", async () => {
    await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "false" });

    const result = await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));

    expect(result.written).toBe(0);
  });

  it("does not generate scorecard for users with isScored set to false", async () => {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const artisan = await createUser(unit.id, {
      fullName: "Lead Artisan",
      isScored: false,
    });

    await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));

    expect(
      await testDb.userScorePeriod.count({ where: { userId: artisan.id } }),
    ).toBe(0);
  });
});

describe("trend and decline indicators", () => {
  async function writePeriodScore(userId: string, dateStr: string, total: number) {
    await testDb.userScorePeriod.create({
      data: {
        userId,
        periodStart: new Date(`${dateStr}T00:00:00.000Z`),
        regularity: total,
        followUp: 0,
        total,
        expectedDays: 20,
        writtenDays: Math.round((total / 100) * 20),
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });
  }

  it("returns historic periods sorted chronologically (oldest to newest)", async () => {
    const { artisan } = await setupCompany();
    await writePeriodScore(artisan.id, "2026-05-01", 90);
    await writePeriodScore(artisan.id, "2026-06-01", 78);
    await writePeriodScore(artisan.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.periods.map((p) => p.total)).toEqual([64, 78, 90]);
  });

  it("flags consecutive 3-period score decline", async () => {
    const { artisan } = await setupCompany();
    await writePeriodScore(artisan.id, "2026-05-01", 90);
    await writePeriodScore(artisan.id, "2026-06-01", 78);
    await writePeriodScore(artisan.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.declining).toBe(true);
  });

  it("does not flag decline if only 2 periods of decline exist", async () => {
    const { artisan } = await setupCompany();
    await writePeriodScore(artisan.id, "2026-05-01", 90);
    await writePeriodScore(artisan.id, "2026-06-01", 78);

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.declining).toBe(false);
  });

  it("does not flag decline if an intermediate period increased", async () => {
    const { artisan } = await setupCompany();
    await writePeriodScore(artisan.id, "2026-04-01", 95);
    await writePeriodScore(artisan.id, "2026-05-01", 70);
    await writePeriodScore(artisan.id, "2026-06-01", 85);
    await writePeriodScore(artisan.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.declining).toBe(false);
  });

  it("triggers decline flag when decline threshold is set to 7 periods", async () => {
    const { artisan } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.scoringDeclinePeriods]: "7" });

    const totals = [95, 90, 85, 80, 75, 70, 65];
    for (const [i, total] of totals.entries()) {
      await writePeriodScore(artisan.id, `2026-0${i + 1}-01`, total);
    }

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.declining).toBe(true);
    expect(trend.periods).toHaveLength(6);
  });

  it("does not flag decline if only 6 periods decline when threshold is 7", async () => {
    const { artisan } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.scoringDeclinePeriods]: "7" });

    const totals = [90, 85, 80, 75, 70, 65];
    for (const [i, total] of totals.entries()) {
      await writePeriodScore(artisan.id, `2026-0${i + 1}-01`, total);
    }

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.declining).toBe(false);
  });

  it("returns empty trend for user outside visibility scope", async () => {
    const { artisan } = await setupCompany();
    const planning = await createOrgUnit({ name: "Planning", type: "Root" }).catch(
      async () => {
        const rootUnit = await testDb.orgUnit.findFirst({ where: { parentId: null } });
        return testDb.orgUnit.create({
          data: { name: "Planning", type: "Unit", parentId: rootUnit!.id },
        });
      },
    );
    const outsider = await createUser(planning.id, { fullName: "Outsider" });
    await writePeriodScore(artisan.id, "2026-07-01", 64);

    const trend = await readScoreTrend(
      testDb,
      { id: outsider.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.periods).toHaveLength(0);
    expect(trend.declining).toBe(false);
  });
});

describe("closed period scores from viewer perspective", () => {
  async function setupCompanyWithActivities() {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const workshop = await createOrgUnit({
      name: "Workshop",
      parentId: root.id,
      requiresApproval: true,
    });

    const gm = await createUser(root.id, {
      fullName: "General Manager",
      isUnitManager: true,
    });
    const manager = await createUser(workshop.id, {
      fullName: "Workshop Manager",
      isUnitManager: true,
    });
    const artisan = await createUser(workshop.id, { fullName: "Lead Artisan" });
    const colleague = await createUser(workshop.id, { fullName: "Colleague Artisan" });

    for (const person of [artisan, colleague]) {
      for (const day of ["2026-07-06", "2026-07-07", "2026-07-08"]) {
        await createActivity(person, {
          activityDate: new Date(`${day}T00:00:00.000Z`),
          approvalStatus: "APPROVED",
          approverId: manager.id,
          approvalSubmittedAt: new Date(`${day}T08:00:00.000Z`),
          approvalDecidedAt: new Date(`${day}T09:00:00.000Z`),
        });
      }
    }

    for (const day of ["2026-07-09", "2026-07-10"]) {
      await createActivity(artisan, {
        activityDate: new Date(`${day}T00:00:00.000Z`),
        approvalStatus: "PENDING_APPROVAL",
        approverId: manager.id,
        approvalSubmittedAt: new Date(`${day}T08:00:00.000Z`),
      });
    }

    await closeScorePeriod(testDb, periodCloseTimestamp(2026, 8));

    const rawRow = async (userId: string) =>
      testDb.userScorePeriod.findUniqueOrThrow({
        where: {
          userId_periodStart_revisionNo: {
            userId,
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            revisionNo: 1,
          },
        },
      });

    return { gm, manager, artisan, colleague, rawRow };
  }

  it("unseen activities alter raw score baseline", async () => {
    const { artisan, colleague, rawRow } = await setupCompanyWithActivities();

    const artisanRaw = await rawRow(artisan.id);
    const colleagueRaw = await rawRow(colleague.id);

    expect(artisanRaw.total).not.toBe(colleagueRaw.total);
  });

  it("user sees their own raw period score", async () => {
    const { artisan, rawRow } = await setupCompanyWithActivities();

    const trend = await readScoreTrend(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.periods[0]?.total).toBe((await rawRow(artisan.id)).total);
  });

  it("active approver sees pending activities and arrives at matching score", async () => {
    const { manager, artisan, rawRow } = await setupCompanyWithActivities();

    const trend = await readScoreTrend(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.periods[0]?.total).toBe((await rawRow(artisan.id)).total);
  });

  it("upper manager sees scope-filtered score rather than raw score", async () => {
    const { gm, artisan, rawRow } = await setupCompanyWithActivities();

    const trend = await readScoreTrend(
      testDb,
      { id: gm.id, isSystemAdmin: false },
      artisan.id,
    );

    expect(trend.periods[0]?.total).not.toBe((await rawRow(artisan.id)).total);
  });

  it("invisible activities do not alter upper manager viewed score", async () => {
    const { gm, artisan, colleague } = await setupCompanyWithActivities();
    const viewer = { id: gm.id, isSystemAdmin: false };

    const artisanTrend = await readScoreTrend(testDb, viewer, artisan.id);
    const colleagueTrend = await readScoreTrend(testDb, viewer, colleague.id);

    expect(artisanTrend.periods[0]?.total).toBe(colleagueTrend.periods[0]?.total);
    expect(artisanTrend.periods[0]?.total).toBeGreaterThan(0);
  });
});

describe("closing month is selected according to company timezone", () => {
  async function closedPeriodStart(now: Date): Promise<string | null> {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "0",
        effectiveAt: new Date("2026-07-31T20:59:00.000Z"),
        reason: "TEST_PERIOD_END_SETTING",
      },
    });

    const result = await closeScorePeriod(testDb, now);
    return result.periodStart;
  }

  it("closes July at August 1st 01:00 company time", async () => {
    expect(await closedPeriodStart(new Date("2026-07-31T22:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("closes July at August 1st 02:59 company time", async () => {
    expect(await closedPeriodStart(new Date("2026-07-31T23:59:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("closes July at August 1st 03:00 company time", async () => {
    expect(await closedPeriodStart(new Date("2026-08-01T00:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("still closes June at July 31st 23:00 company time", async () => {
    expect(await closedPeriodStart(new Date("2026-07-31T20:00:00.000Z"))).toBe(
      "2026-06-01",
    );
  });
});
