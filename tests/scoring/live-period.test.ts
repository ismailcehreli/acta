import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, rejectActivity } from "@/server/activities/approval";
import { createActivity as writeActivityService } from "@/server/activities/write";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { readUserScore } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Denominator of live period scoring:
// In an active period, expected working days are counted up to current company day (min(today, periodEnd)).
// In a closed period, the denominator is the full month.

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
  return { artisan };
}

describe("denominator in live period is counted up to current date", () => {
  // Aug 3, 2026 is Monday. Aug 1 (Sat) and Aug 2 (Sun) are weekend; exactly 1 working day so far.
  const AUGUST_THIRD = new Date("2026-08-03T09:00:00.000Z");

  it("at month start, denominator counts only elapsed working days", async () => {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const score = await readUserScore(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
      AUGUST_THIRD,
    );

    expect(score?.expectedDays).toBe(1);
    expect(score?.writtenDays).toBe(1);
  });

  it("future days do not penalize regularity score", async () => {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const score = await readUserScore(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
      AUGUST_THIRD,
    );

    expect(score?.regularity).toBe(90);
  });

  it("denominator grows as month progresses", async () => {
    const { artisan } = await setupCompany();

    const onThird = await readUserScore(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
      AUGUST_THIRD,
    );
    const onTenth = await readUserScore(
      testDb,
      { id: artisan.id, isSystemAdmin: false },
      artisan.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );

    expect(onThird?.expectedDays).toBe(1);
    expect(onTenth?.expectedDays).toBe(6);
  });

  it("closed period uses full month working days", async () => {
    const { artisan } = await setupCompany();
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, new Date(Date.UTC(2026, 7, 3, 6, 0, 0)));

    const record = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: artisan.id },
    });

    // 23 working weekdays in July 2026.
    expect(record.expectedDays).toBe(23);
  });
});

describe("timestamped operations today in live score", () => {
  const TODAY_AFTERNOON = new Date("2026-08-20T15:00:00.000Z");

  it("decisions made today count towards approval duration score", async () => {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({
      name: "Workshop",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(unit.id, {
      fullName: "Workshop Manager",
      isUnitManager: true,
    });
    const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });

    const write = async (dateStr: string, timestampStr: string) => {
      const result = await writeActivityService(
        testDb,
        { id: artisan.id, orgUnitId: unit.id, requiresApproval: true },
        {
          activityDate: dateStr,
          title: "Mold maintenance performed",
          description: "Mold dismantled, cleaned, and reassembled.",
          targetDepartmentIds: [unit.id],
        },
        new Date(timestampStr),
      );
      if (!result.ok) throw new Error(`Failed to write activity: ${result.error}`);
      return result.activity;
    };

    // Two decisions today: one fast (1 business day), one delayed (5 business days).
    const fastActivity = await write("2026-08-19", "2026-08-19T08:00:00.000Z");
    await approveActivity(
      testDb,
      manager.id,
      fastActivity.id,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    const slowActivity = await write("2026-08-13", "2026-08-13T08:00:00.000Z");
    const reason = await createApprovalReason("REJECTED");
    await rejectActivity(
      testDb,
      manager.id,
      slowActivity.id,
      { reasonId: reason.id },
      new Date("2026-08-20T10:00:00.000Z"),
    );

    const score = await readUserScore(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      manager.id,
      TODAY_AFTERNOON,
    );

    expect(score?.approval).toBe(15);
  });
});
