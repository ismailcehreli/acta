import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { appreciateActivity } from "@/server/scoring/appreciation";
import { closeScorePeriod } from "@/server/scoring/close-period";
import {
  readScoreTrend,
  readTeamScores,
  readUserScore,
} from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const LIVE_DATE = new Date("2026-08-22T09:00:00.000Z");
const APPRECIATE_DATE = new Date("2026-08-21T10:00:00.000Z");
const CLOSE_PERIOD_DATE = new Date("2026-08-03T06:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, {
    [SETTING_KEYS.scoringEnabled]: "true",
    [SETTING_KEYS.appreciationEnabled]: "true",
    [SETTING_KEYS.scoringAppreciationPoints]: "2",
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({
    name: "Tooling Department",
    parentId: root.id,
    requiresApproval: true,
  });
  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
    canAppreciate: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Worker Kadir" });

  const approved = await createActivity(employee, {
    title: "Approved activity",
    activityDate: new Date("2026-08-17T00:00:00.000Z"),
    approvalStatus: "APPROVED",
    approverId: manager.id,
    approvalSubmittedAt: new Date("2026-08-17T08:00:00.000Z"),
    approvalDecidedAt: new Date("2026-08-17T09:00:00.000Z"),
  });
  const pending = await createActivity(employee, {
    title: "Pending activity",
    activityDate: new Date("2026-08-18T00:00:00.000Z"),
    approvalStatus: "PENDING_APPROVAL",
    approverId: manager.id,
    approvalSubmittedAt: new Date("2026-08-18T08:00:00.000Z"),
  });

  return { root, manager, employee, approved, pending };
}

describe("appreciation points in score calculation", () => {
  it("adds appreciation points from approved activities into the total score", async () => {
    const { manager, employee, approved } = await setupCompany();
    const viewer = { id: manager.id, isSystemAdmin: false };

    const before = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);
    expect(before).not.toBeNull();

    const result = await appreciateActivity(
      testDb,
      manager.id,
      approved.id,
      APPRECIATE_DATE,
    );
    expect(result).toEqual({ ok: true });

    const after = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);
    expect(after).not.toBeNull();
    expect(after?.appreciationCount).toBe(1);
    expect(after?.appreciationPointsPer).toBe(2);
    expect(after?.appreciationPoints).toBe(2);
    expect(after?.total).toBe((before?.total ?? 0) + 2);
    expect(after?.baseTotal).toBe((after?.total ?? 0) - 2);

    const team = await readTeamScores(testDb, viewer, LIVE_DATE);
    expect(team.find((score) => score.userId === employee.id)).toMatchObject({
      appreciationCount: 1,
      appreciationPoints: 2,
      total: after?.total,
    });
  });

  it("does not count appreciation on pending unapproved activities into score", async () => {
    const { manager, employee, approved, pending } = await setupCompany();
    const viewer = { id: manager.id, isSystemAdmin: false };

    const before = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);
    await appreciateActivity(testDb, manager.id, approved.id, APPRECIATE_DATE);
    await appreciateActivity(testDb, manager.id, pending.id, APPRECIATE_DATE);

    const after = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);
    expect(after?.appreciationCount).toBe(1);
    expect(after?.appreciationPoints).toBe(2);
    expect(after?.total).toBe((before?.total ?? 0) + 2);
  });

  it("updates appreciation points in live period upon setting change", async () => {
    const { manager, employee, approved } = await setupCompany();
    const viewer = { id: manager.id, isSystemAdmin: false };

    await appreciateActivity(testDb, manager.id, approved.id, APPRECIATE_DATE);
    const twoPoints = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);

    const settingResult = await saveSettings(testDb, {
      [SETTING_KEYS.scoringAppreciationPoints]: "5",
    });
    expect(settingResult.ok).toBe(true);
    expect(
      await testDb.scoreSettingEvent.findFirst({
        where: {
          key: SETTING_KEYS.scoringAppreciationPoints,
          value: "5",
        },
      }),
    ).not.toBeNull();

    const fivePoints = await readUserScore(testDb, viewer, employee.id, LIVE_DATE);
    expect(fivePoints?.appreciationPointsPer).toBe(5);
    expect(fivePoints?.appreciationPoints).toBe(5);
    expect(fivePoints?.total).toBe((twoPoints?.total ?? 0) + 3);
  });

  it("preserves closed period appreciation points regardless of subsequent setting changes", async () => {
    const { manager, employee } = await setupCompany();
    const julyActivity = await createActivity(employee, {
      title: "July activity",
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-07-15T08:00:00.000Z"),
      approvalDecidedAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    await appreciateActivity(
      testDb,
      manager.id,
      julyActivity.id,
      new Date("2026-07-20T10:00:00.000Z"),
    );

    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.scoringAppreciationPoints,
        value: "2",
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        reason: "TEST",
      },
    });

    await closeScorePeriod(testDb, CLOSE_PERIOD_DATE);
    const row = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: new Date("2026-07-01T00:00:00.000Z") },
      select: { total: true, appreciationPointsPer: true },
    });
    expect(row.appreciationPointsPer).toBe(2);
    expect(
      await testDb.userScorePeriodFact.count({
        where: { userId: employee.id, kind: "APPRECIATION" },
      }),
    ).toBe(1);

    const before = await readScoreTrend(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      employee.id,
    );

    const settingResult = await saveSettings(testDb, {
      [SETTING_KEYS.scoringAppreciationPoints]: "7",
    });
    expect(settingResult.ok).toBe(true);

    const after = await readScoreTrend(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      employee.id,
    );
    expect(before).toEqual({
      periods: [{ periodStart: "2026-07-01", total: row.total }],
      declining: false,
    });
    expect(after).toEqual(before);
  });
});
