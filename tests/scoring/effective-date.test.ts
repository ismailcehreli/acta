import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeScorePeriod,
  drainScorePeriodWork,
} from "@/server/scoring/close-period";
import { correctUserScoreHistory } from "@/server/scoring/historical-correction";
import { readScoreTrend } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const JULY_START = new Date("2026-07-01T00:00:00.000Z");
const CLOSING_DATE = new Date("2026-08-25T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, {
    [SETTING_KEYS.scoringEnabled]: "true",
    [SETTING_KEYS.retroactiveEntryDays]: "1",
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("delayed closing uses effective-date snapshot", () => {
  it("role, unit, and calendar changes after period ends are not applied to July", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const oldUnit = await createOrgUnit({
      name: "Old Unit",
      parentId: root.id,
      requiresApproval: false,
    });
    const newUnit = await createOrgUnit({
      name: "New Unit",
      parentId: root.id,
      requiresApproval: true,
    });
    const employee = await createUser(oldUnit.id, {
      fullName: "July Employee",
      isUnitManager: false,
    });

    // Trusted baseline snapshot during period. Subsequent real table modifications
    // generate events via database trigger.
    await testDb.scoreOrgUnitStateEvent.createMany({
      data: [
        {
          orgUnitId: oldUnit.id,
          effectiveAt: JULY_START,
          parentId: root.id,
          isActive: true,
          requiresApproval: false,
          reason: "TEST_BASELINE",
        },
        {
          orgUnitId: newUnit.id,
          effectiveAt: JULY_START,
          parentId: root.id,
          isActive: true,
          requiresApproval: true,
          reason: "TEST_BASELINE",
        },
      ],
    });
    await testDb.scoreUnitCalendarEvent.create({
      data: {
        orgUnitId: oldUnit.id,
        effectiveAt: JULY_START,
        hasOwnCalendar: true,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        worksOnHolidays: false,
        reason: "TEST_BASELINE",
      },
    });
    await testDb.scoreCompanyCalendarEvent.create({
      data: {
        effectiveAt: JULY_START,
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1050,
        reason: "TEST_BASELINE",
      },
    });

    // After July ends, employee becomes manager and moves to 7-day work week unit.
    // Live rows no longer represent July state.
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: newUnit.id,
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        workStartMinute: 420,
        workEndMinute: 1140,
        worksOnHolidays: true,
      },
    });
    await testDb.user.update({
      where: { id: employee.id },
      data: { orgUnitId: newUnit.id, isUnitManager: true },
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    const period = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: JULY_START },
      select: { profile: true, expectedDays: true },
    });
    expect(period.profile).toBe("unapproved");
    expect(period.expectedDays, "July weekdays").toBe(23);
  });

  it("denominator of employee leaving mid-period ends before departure date", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const employee = await createUser(unit.id, { fullName: "Departed Employee" });

    await testDb.scoreOrgUnitStateEvent.create({
      data: {
        orgUnitId: unit.id,
        effectiveAt: JULY_START,
        parentId: root.id,
        isActive: true,
        requiresApproval: false,
        reason: "TEST_BASELINE",
      },
    });
    await testDb.scoreUserStateEvent.create({
      data: {
        userId: employee.id,
        effectiveAt: new Date("2026-07-20T09:00:00.000Z"),
        isActive: false,
        isScored: true,
        writesActivities: true,
        isUnitManager: false,
        orgUnitId: unit.id,
        reason: "DEACTIVATED",
      },
    });
    await testDb.user.update({
      where: { id: employee.id },
      data: { isActive: false },
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    const period = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: JULY_START },
      select: { expectedDays: true },
    });
    expect(period.expectedDays, "Weekdays between July 1-19").toBe(13);
  });

  it("unit calendar and holiday added after period do not apply retroactively to July", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const employee = await createUser(unit.id, { fullName: "Calendar Employee" });

    // These two live rows were created after July ended. If history query fell back
    // to current table, they would erroneously apply to July.
    await testDb.orgUnitWorkCalendar.create({
      data: {
        orgUnitId: unit.id,
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        workStartMinute: 420,
        workEndMinute: 1140,
        worksOnHolidays: false,
      },
    });
    await testDb.holiday.create({
      data: {
        date: new Date("2026-07-15T00:00:00.000Z"),
        description: "Holiday added later",
      },
    });

    await closeScorePeriod(testDb, CLOSING_DATE);

    const period = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: JULY_START },
      select: { expectedDays: true },
    });
    expect(period.expectedDays, "July month-end weekdays").toBe(23);
  });

  it("justified historical correction produces new revision without modifying old scorecard", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const admin = await createUser(root.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    const employee = await createUser(unit.id, {
      fullName: "Corrected Employee",
      isUnitManager: false,
    });
    await testDb.scoreOrgUnitStateEvent.create({
      data: {
        orgUnitId: unit.id,
        effectiveAt: JULY_START,
        parentId: root.id,
        isActive: true,
        requiresApproval: false,
        reason: "TEST_BASELINE",
      },
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    const initialPeriod = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: JULY_START },
      select: { revisionNo: true, profile: true },
    });
    expect(initialPeriod).toEqual({ revisionNo: 1, profile: "unapproved" });

    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: employee.id,
        effectiveAt: new Date("2026-07-01T09:00:00.000Z"),
        reason: "Confirmed manager role in July",
        state: {
          isActive: true,
          isScored: true,
          writesActivities: true,
          isUnitManager: true,
          orgUnitId: unit.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    await closeScorePeriod(testDb, new Date("2026-08-10T09:01:00.000Z"));

    const revisions = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, periodStart: JULY_START },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, profile: true, revisionReason: true },
    });
    expect(revisions).toEqual([
      { revisionNo: 1, profile: "unapproved", revisionReason: "INITIAL" },
      {
        revisionNo: 2,
        profile: "manager",
        revisionReason: "USER_HISTORY_CORRECTION",
      },
    ]);
  });

  it("voids scorecard without falling back to old score if user was not scored that month", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });
    const admin = await createUser(root.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    const employee = await createUser(unit.id, {
      fullName: "Mistakenly Scored Employee",
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: employee.id,
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        reason: "Should not have been scored in July",
        state: {
          isActive: true,
          isScored: false,
          writesActivities: true,
          isUnitManager: false,
          orgUnitId: unit.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    await closeScorePeriod(testDb, new Date("2026-08-10T09:01:00.000Z"));

    const revisions = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, periodStart: JULY_START },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, voided: true },
    });
    expect(revisions).toEqual([
      { revisionNo: 1, voided: false },
      { revisionNo: 2, voided: true },
    ]);
    expect(
      await readScoreTrend(
        testDb,
        { id: employee.id, isSystemAdmin: false },
        employee.id,
      ),
    ).toEqual({ periods: [], declining: false });
  });
});

describe("retroactive correction can add user to closed period", () => {
  it("justified correction writes first scorecard for user erroneously excluded", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({
      name: "Tooling Shop",
      parentId: root.id,
      requiresApproval: false,
    });
    const admin = await createUser(root.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
      isScored: false,
      writesActivities: false,
    });
    // Employee erroneously marked non-scored during July.
    const employee = await createUser(unit.id, {
      fullName: "Excluded Employee",
      isScored: false,
    });
    await createActivity(employee, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({ where: { userId: employee.id } }),
      "should have no scorecard since user was excluded at close time",
    ).toBe(0);
    const ledger = await testDb.scorePeriodLedger.findUniqueOrThrow({
      where: { periodStart: JULY_START },
      select: { formulaVersion: true },
    });

    const correction = await correctUserScoreHistory(
      testDb,
      admin.id,
      {
        userId: employee.id,
        effectiveAt: JULY_START,
        reason: "Should have been scored in July, excluded erroneously",
        state: {
          isActive: true,
          isScored: true,
          writesActivities: true,
          isUnitManager: false,
          orgUnitId: unit.id,
        },
      },
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(correction).toMatchObject({ ok: true, queuedPeriods: 1 });

    // Actual queue worker.
    const drainResult = await drainScorePeriodWork(
      testDb,
      new Date("2026-08-10T09:01:00.000Z"),
    );
    expect(drainResult).toMatchObject({ processed: 1, written: 1 });

    const revisions = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, periodStart: JULY_START },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, voided: true, revisionReason: true, formulaVersion: true },
    });
    // First revision is written using formula version from period ledger:
    // since no prior scorecard existed, there is no previous formula version to copy.
    expect(revisions).toEqual([
      {
        revisionNo: 1,
        voided: false,
        revisionReason: "USER_HISTORY_CORRECTION",
        formulaVersion: ledger.formulaVersion,
      },
    ]);

    // Scorecard visible on screen and recorded days reflected in denominator.
    const trend = await readScoreTrend(
      testDb,
      { id: employee.id, isSystemAdmin: false },
      employee.id,
    );
    expect(trend.periods).toHaveLength(1);
    expect(trend.periods[0].periodStart).toBe("2026-07-01");

    // No pending recalculations left in queue.
    expect(
      await testDb.scoreRecalculationRequest.count({ where: { processedAt: null } }),
    ).toBe(0);
  });
});
