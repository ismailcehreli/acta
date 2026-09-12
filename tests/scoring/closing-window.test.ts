import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity as createActivityService } from "@/server/activities/write";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Period closing respects the retroactive activity entry window.
// A score period must not freeze while users can still legitimately submit activities for it.

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
  const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });
  return { unit, artisan };
}

async function createRetroactiveEvent(value: string, effectiveAt: Date) {
  await testDb.scoreSettingEvent.create({
    data: {
      key: SETTING_KEYS.retroactiveEntryDays,
      value,
      effectiveAt,
      reason: "TEST_PERIOD_END_SETTING",
    },
  });
}

describe("period close awaits retroactive entry window", () => {
  it("July does not close on August 1st while yesterday's entry window is open", async () => {
    await setupCompany();

    const result = await closeScorePeriod(
      testDb,
      new Date("2026-07-31T21:01:00.000Z"),
    );

    expect(result.periodStart).toBeNull();
    expect(result.written).toBe(0);
    expect(await testDb.userScorePeriod.count()).toBe(0);
  });

  it("yesterday entry submitted within allowed window is included when period closes", async () => {
    const { unit, artisan } = await setupCompany();

    const created = await createActivityService(
      testDb,
      { id: artisan.id, orgUnitId: unit.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Activity logged for last day of month",
        description: "Legitimately logged next morning within window.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-01T00:10:00.000Z"),
    );
    expect(created.ok).toBe(true);

    const result = await closeScorePeriod(
      testDb,
      new Date("2026-08-02T00:10:00.000Z"),
    );
    expect(result.periodStart).toBe("2026-07-01");

    const facts = await testDb.userScorePeriodFact.count({
      where: { userId: artisan.id, kind: "WRITTEN" },
    });
    expect(facts).toBe(1);
  });

  it("waits longer if retroactive entry setting is increased", async () => {
    await setupCompany();
    await createRetroactiveEvent("5", new Date("2026-07-31T20:59:00.000Z"));

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-03T06:00:00.000Z")))
        .periodStart,
    ).toBeNull();

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-06T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
  });

  it("retroactive setting change in subsequent month does not reopen closed period", async () => {
    await setupCompany();
    await createRetroactiveEvent("1", new Date("2026-07-31T20:59:00.000Z"));
    await createRetroactiveEvent("5", new Date("2026-08-01T09:00:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "5" });

    const result = await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
    );
    expect(result.periodStart).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 1 });
  });

  it("reducing retroactive days in next month does not shorten active prior window", async () => {
    await setupCompany();
    await createRetroactiveEvent("5", new Date("2026-07-31T20:59:00.000Z"));
    await createRetroactiveEvent("1", new Date("2026-08-01T09:00:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "1" });

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z")))
        .periodStart,
    ).toBeNull();
    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-06T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 5 });
  });

  it("evaluates effective setting date based on company timezone day rather than UTC", async () => {
    await setupCompany();
    await createRetroactiveEvent("1", new Date("2026-07-31T20:59:00.000Z"));
    await createRetroactiveEvent("5", new Date("2026-07-31T21:30:00.000Z"));
    await saveSettings(testDb, { [SETTING_KEYS.retroactiveEntryDays]: "5" });

    expect(
      (await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z")))
        .periodStart,
    ).toBe("2026-07-01");
    expect(
      await testDb.scorePeriodLedger.findUniqueOrThrow({
        where: { periodStart: new Date("2026-07-01") },
        select: { retroactiveDays: true },
      }),
    ).toEqual({ retroactiveDays: 1 });
  });
});

describe("delayed period closure", () => {
  it("does not generate scorecard for user created after period ended", async () => {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });

    const existingUser = await createUser(unit.id, { fullName: "Existing Employee" });
    const newUser = await createUser(unit.id, { fullName: "New Employee" });
    await testDb.user.update({
      where: { id: newUser.id },
      data: { createdAt: new Date("2026-08-25T09:00:00.000Z") },
    });

    const result = await closeScorePeriod(
      testDb,
      new Date("2026-08-25T12:00:00.000Z"),
    );
    expect(result.periodStart).toBe("2026-07-01");

    expect(
      await testDb.userScorePeriod.count({ where: { userId: existingUser.id } }),
    ).toBe(1);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: newUser.id } }),
    ).toBe(0);
  });

  it("generates scorecard for user created within the period", async () => {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const user = await createUser(unit.id, { fullName: "Joined In July" });
    await testDb.user.update({
      where: { id: user.id },
      data: { createdAt: new Date("2026-07-20T09:00:00.000Z") },
    });

    await closeScorePeriod(testDb, new Date("2026-08-25T12:00:00.000Z"));

    expect(
      await testDb.userScorePeriod.count({ where: { userId: user.id } }),
    ).toBe(1);
  });
});
