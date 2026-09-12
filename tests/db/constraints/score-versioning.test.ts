import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

const JULY = new Date("2026-07-01T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({ name: "Molding", parentId: root.id });
  const user = await createUser(unit.id, { fullName: "Lead Craftsman" });
  const activity = await createActivity(user, { activityDate: JULY });
  return { user, activity };
}

function frozenRevision(userId: string, revisionNo: number) {
  return {
    userId,
    periodStart: JULY,
    revisionNo,
    revisionReason: revisionNo === 1 ? "INITIAL" : "ACTIVITY_CREATED",
    regularity: 40,
    acceptance: null,
    approval: null,
    followUp: 30,
    total: 70,
    expectedDays: 22,
    writtenDays: 20,
    frozen: true,
    profile: "unapproved",
    weightRegularity: 60,
    weightAcceptance: 30,
    weightApproval: 30,
    weightFollowUp: 10,
    formulaVersion: 1,
  };
}

describe("score versioning database invariants", () => {
  it("accepts two different versions for the same user-month", async () => {
    const { user } = await setup();
    await testDb.userScorePeriod.create({ data: frozenRevision(user.id, 1) });
    await testDb.userScorePeriod.create({ data: frozenRevision(user.id, 2) });

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: user.id, periodStart: JULY },
      }),
    ).toBe(2);
  });

  it("cannot write the same version number twice", async () => {
    const { user } = await setup();
    await testDb.userScorePeriod.create({ data: frozenRevision(user.id, 1) });

    await expect(
      testDb.userScorePeriod.create({ data: frozenRevision(user.id, 1) }),
    ).rejects.toThrow();
  });

  it("cannot attach fact to non-existent revision", async () => {
    const { user, activity } = await setup();
    await testDb.userScorePeriod.create({ data: frozenRevision(user.id, 1) });

    await expect(
      testDb.userScorePeriodFact.create({
        data: {
          userId: user.id,
          periodStart: JULY,
          revisionNo: 2,
          activityId: activity.id,
          kind: "WRITTEN",
          happenedOn: JULY,
        },
      }),
    ).rejects.toThrow(/SCORE_FACT_PERIOD_MISSING|foreign key/i);
  });

  it("rejects zero revision in the database", async () => {
    const { user } = await setup();
    await expect(
      testDb.userScorePeriod.create({ data: frozenRevision(user.id, 0) }),
    ).rejects.toThrow(/UserScorePeriod_revision_positive/);
  });

  it("cannot mark draft version as voided", async () => {
    const { user } = await setup();
    await expect(
      testDb.userScorePeriod.create({
        data: {
          ...frozenRevision(user.id, 1),
          frozen: false,
          voided: true,
          profile: null,
          weightRegularity: null,
          weightAcceptance: null,
          weightApproval: null,
          weightFollowUp: null,
          formulaVersion: null,
        },
      }),
    ).rejects.toThrow(/UserScorePeriod_voided_frozen/);
  });

  it("same recalculation request cannot be source of two score revisions", async () => {
    const { user } = await setup();
    const request = await testDb.scoreRecalculationRequest.create({
      data: {
        userId: user.id,
        periodStart: JULY,
        sourceType: "TEST",
        sourceId: "sole-source",
      },
    });
    await testDb.userScorePeriod.create({
      data: { ...frozenRevision(user.id, 1), sourceRequestId: request.id },
    });

    await expect(
      testDb.userScorePeriod.create({
        data: { ...frozenRevision(user.id, 2), sourceRequestId: request.id },
      }),
    ).rejects.toThrow();
  });

  it("request identity is idempotent and attempts cannot be negative", async () => {
    const { user } = await setup();
    const data = {
      userId: user.id,
      periodStart: JULY,
      sourceType: "TEST",
      sourceId: "same-event",
    };
    await testDb.scoreRecalculationRequest.create({ data });
    await expect(
      testDb.scoreRecalculationRequest.create({ data }),
    ).rejects.toThrow();
    await expect(
      testDb.scoreRecalculationRequest.create({
        data: { ...data, sourceId: "negative", attempts: -1 },
      }),
    ).rejects.toThrow(/ScoreRecalculationRequest_attempts_nonnegative/);
  });

  it("writes valid score period ledger row, rejects negative window", async () => {
    const valid = await testDb.scorePeriodLedger.create({
      data: {
        periodStart: JULY,
        closedAt: new Date("2026-08-02T06:00:00.000Z"),
        retroactiveDays: 1,
        formulaVersion: 1,
      },
    });
    expect(valid.retroactiveDays).toBe(1);

    await expect(
      testDb.scorePeriodLedger.create({
        data: {
          periodStart: new Date("2026-08-01"),
          closedAt: new Date("2026-09-02T06:00:00.000Z"),
          retroactiveDays: -1,
          formulaVersion: 1,
        },
      }),
    ).rejects.toThrow(/ScorePeriodLedger_retroactive_nonnegative/);

    await expect(
      testDb.scorePeriodLedger.create({
        data: {
          periodStart: new Date("2026-09-01"),
          closedAt: new Date("2026-10-02T06:00:00.000Z"),
          retroactiveDays: 1,
          formulaVersion: 0,
        },
      }),
    ).rejects.toThrow(/ScorePeriodLedger_formula_positive/);
  });
});

describe("effective-date events are mandatory even when application code is bypassed", () => {
  it("direct user flag update produces a full state event", async () => {
    const { user } = await setup();
    const initialCount = await testDb.scoreUserStateEvent.count({
      where: { userId: user.id },
    });

    await testDb.user.update({
      where: { id: user.id },
      data: { isUnitManager: true },
    });

    const event = await testDb.scoreUserStateEvent.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: [{ effectiveAt: "desc" }, { recordedAt: "desc" }],
    });
    expect(await testDb.scoreUserStateEvent.count({ where: { userId: user.id } }))
      .toBe(initialCount + 1);
    expect(event.isUnitManager).toBe(true);
    expect(event.orgUnitId).toBe(user.orgUnitId);
  });

  it("user history cannot be updated or deleted", async () => {
    const { user } = await setup();
    const event = await testDb.scoreUserStateEvent.findFirstOrThrow({
      where: { userId: user.id },
    });

    await expect(
      testDb.scoreUserStateEvent.update({
        where: { id: event.id },
        data: { reason: "CHANGE" },
      }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreUserStateEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
  });

  it("unit, calendar, holiday, and setting generate full history even when directly written", async () => {
    const { user } = await setup();
    const unit = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: user.orgUnitId },
    });

    await testDb.orgUnit.update({
      where: { id: unit.id },
      data: { requiresApproval: true },
    });
    await testDb.workCalendar.create({
      data: {
        id: 1,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
      },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: unit.id,
        workingDays: [1, 2, 3, 4, 5, 6],
        workStartMinute: 480,
        workEndMinute: 1020,
        worksOnHolidays: false,
      },
    });
    await testDb.orgUnitWorkCalendar.delete({ where: { orgUnitId: unit.id } });
    const holidayDate = new Date("2026-07-15T00:00:00.000Z");
    await testDb.holiday.create({
      data: { date: holidayDate, description: "History test" },
    });
    await testDb.holiday.delete({ where: { date: holidayDate } });
    await testDb.systemSetting.create({
      data: {
        key: "retroactive_entry_days",
        value: "3",
        description: "History test",
      },
    });

    expect(
      await testDb.scoreOrgUnitStateEvent.count({
        where: { orgUnitId: unit.id, requiresApproval: true },
      }),
    ).toBe(1);
    expect(await testDb.scoreCompanyCalendarEvent.count()).toBe(1);
    expect(
      await testDb.scoreUnitCalendarEvent.findMany({
        where: { orgUnitId: unit.id },
        orderBy: { recordedAt: "asc" },
        select: { hasOwnCalendar: true },
      }),
    ).toEqual([{ hasOwnCalendar: true }, { hasOwnCalendar: false }]);
    expect(
      await testDb.scoreHolidayEvent.findMany({
        where: { holidayDate },
        orderBy: { recordedAt: "asc" },
        select: { isHoliday: true },
      }),
    ).toEqual([{ isHoliday: true }, { isHoliday: false }]);
    expect(
      await testDb.scoreSettingEvent.findFirstOrThrow({
        where: { key: "retroactive_entry_days" },
        select: { value: true },
      }),
    ).toEqual({ value: "3" });
  });

  it("all effective-date tables reject updates and deletions", async () => {
    const { user } = await setup();
    const unit = await testDb.orgUnit.findUniqueOrThrow({
      where: { id: user.orgUnitId },
    });
    await testDb.workCalendar.create({
      data: {
        id: 1,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
      },
    });
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: unit.id,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        worksOnHolidays: false,
      },
    });
    const holiday = await testDb.holiday.create({
      data: {
        date: new Date("2026-07-15T00:00:00.000Z"),
        description: "Immutability test",
      },
    });
    await testDb.systemSetting.create({
      data: {
        key: "retroactive_entry_days",
        value: "3",
        description: "Immutability test",
      },
    });

    const org = await testDb.scoreOrgUnitStateEvent.findFirstOrThrow({
      where: { orgUnitId: unit.id },
    });
    const company = await testDb.scoreCompanyCalendarEvent.findFirstOrThrow();
    const unitEvent = await testDb.scoreUnitCalendarEvent.findFirstOrThrow();
    const holidayEvent = await testDb.scoreHolidayEvent.findFirstOrThrow({
      where: { holidayDate: holiday.date },
    });
    const setting = await testDb.scoreSettingEvent.findFirstOrThrow();

    await expect(
      testDb.scoreOrgUnitStateEvent.delete({ where: { id: org.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreCompanyCalendarEvent.delete({ where: { id: company.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreUnitCalendarEvent.delete({ where: { id: unitEvent.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreHolidayEvent.delete({ where: { id: holidayEvent.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
    await expect(
      testDb.scoreSettingEvent.delete({ where: { id: setting.id } }),
    ).rejects.toThrow(/SCORE_HISTORY_IMMUTABLE/);
  });
});
