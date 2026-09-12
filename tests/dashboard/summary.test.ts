import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  operationsSummary,
  teamParticipationToday,
} from "@/server/dashboard/summary";
import { JOB_NAMES, recordJobSuccess } from "@/server/jobs/status";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Dashboard summaries test suite.
// Team participation summary is configurable and disabled by default.

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupTeam() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const user1 = await createUser(root.id, { fullName: "User One" });
  const user2 = await createUser(root.id, { fullName: "User Two" });
  const user3 = await createUser(root.id, { fullName: "User Three" });

  return {
    root,
    allUserIds: [user1.id, user2.id, user3.id],
    user1,
    user2,
    user3,
  };
}

async function logActivity(
  user: { id: string; orgUnitId: string },
  day: string,
  approvalStatus: "APPROVED" | "CANCELLED" = "APPROVED",
) {
  await testDb.activity.create({
    data: {
      authorId: user.id,
      authorOrgUnitId: user.orgUnitId,
      activityDate: new Date(`${day}T00:00:00.000Z`),
      title: "Title",
      description: "Description",
      approvalStatus,
    },
  });
}

describe("team participation", () => {
  it("returns null when setting is disabled", async () => {
    const { allUserIds, user1 } = await setupTeam();
    await logActivity(user1, "2026-08-18");

    expect(await teamParticipationToday(testDb, allUserIds, NOW)).toBeNull();
  });

  it("counts users who logged activities today when setting is enabled", async () => {
    const { allUserIds, user1, user2 } = await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await logActivity(user1, "2026-08-18");
    await logActivity(user2, "2026-08-18");
    // Duplicate entry from same user does not increment count
    await logActivity(user1, "2026-08-18");

    expect(await teamParticipationToday(testDb, allUserIds, NOW)).toEqual({
      people: 3,
      wrote: 2,
    });
  });

  it("excludes yesterday entries and cancelled activities from today count", async () => {
    const { allUserIds, user1, user2 } = await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await logActivity(user1, "2026-08-17");
    await logActivity(user2, "2026-08-18", "CANCELLED");

    expect(await teamParticipationToday(testDb, allUserIds, NOW)).toEqual({
      people: 3,
      wrote: 0,
    });
  });

  it("excludes users not expected to log activities from denominator", async () => {
    const { allUserIds, user1, user3 } = await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.update({
      where: { id: user3.id },
      data: { writesActivities: false },
    });
    await logActivity(user1, "2026-08-18");

    expect(await teamParticipationToday(testDb, allUserIds, NOW)).toEqual({
      people: 2,
      wrote: 1,
    });
  });

  it("returns null when no users are expected to log activities", async () => {
    const { allUserIds } = await setupTeam();
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });
    await testDb.user.updateMany({
      where: { id: { in: allUserIds } },
      data: { writesActivities: false },
    });

    expect(await teamParticipationToday(testDb, allUserIds, NOW)).toBeNull();
  });

  it("returns null when user has no subordinates", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.managerParticipationSummary]: "true",
    });

    expect(await teamParticipationToday(testDb, [], NOW)).toBeNull();
  });
});

describe("operations summary", () => {
  it("returns queue, jobs, and backup status", async () => {
    const { user1 } = await setupTeam();
    await testDb.notificationQueue.createMany({
      data: [
        {
          userId: user1.id,
          eventType: "question_asked",
          channel: "EMAIL",
          payload: {},
          idempotencyKey: "a",
          status: "PENDING",
        },
        {
          userId: user1.id,
          eventType: "question_asked",
          channel: "EMAIL",
          payload: {},
          idempotencyKey: "b",
          status: "FAILED",
        },
      ],
    });

    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(
        testDb,
        jobName,
        new Date(NOW.getTime() - 10_000),
        jobName === JOB_NAMES.backup ? 24 * 60 : 1,
      );
    }

    const summary = await operationsSummary(testDb, NOW);

    expect(summary.queuePending).toBe(1);
    expect(summary.queueFailed).toBe(1);
    expect(summary.backupMonitoring).toBe(false);
    expect(summary.jobsTotal).toBe(Object.values(JOB_NAMES).length - 1);
    expect(summary.jobsDelayed).toBe(0);
    expect(summary.backupAgeHours).toBe(0);
  });

  it("handles scenario where no backups have occurred yet", async () => {
    const summary = await operationsSummary(testDb, NOW);

    expect(summary.backupMonitoring).toBe(false);
    expect(summary.backupAgeHours).toBeNull();
    expect(summary.jobsDelayed).toBe(summary.jobsTotal);
  });

  it("does not include activity content payload in operations summary", async () => {
    const { user1 } = await setupTeam();
    await logActivity(user1, "2026-08-18");

    const summary = await operationsSummary(testDb, NOW);

    expect(JSON.stringify(summary)).not.toContain("Title");
    expect(JSON.stringify(summary)).not.toContain("Description");
  });
});

describe("absence periods excluded from team participation denominator", () => {
  it("excludes user on approved leave from denominator", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const manager = await createUser(root.id, {
      email: "manager@example.test",
      isUnitManager: true,
    });
    const employee = await createUser(root.id, { email: "employee@example.test" });
    const absentUser = await createUser(root.id, { email: "absent@example.test" });

    await testDb.systemSetting.upsert({
      where: { key: "manager_participation_summary" },
      create: {
        key: "manager_participation_summary",
        value: "true",
        description: "test",
      },
      update: { value: "true" },
    });

    const day = new Date("2026-08-21T09:00:00.000Z");

    await createActivity(employee, { activityDate: new Date("2026-08-21T00:00:00.000Z") });

    await testDb.noActivityPeriod.create({
      data: {
        userId: absentUser.id,
        startDate: new Date("2026-08-20T00:00:00.000Z"),
        endDate: new Date("2026-08-25T00:00:00.000Z"),
        note: "Annual leave",
        markedById: manager.id,
      },
    });

    const result = await teamParticipationToday(
      testDb,
      [employee.id, absentUser.id],
      day,
    );

    expect(result).toEqual({ people: 1, wrote: 1 });
  });

  it("includes user in denominator on dates outside their leave window", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const manager = await createUser(root.id, {
      email: "manager2@example.test",
      isUnitManager: true,
    });
    const absentUser = await createUser(root.id, { email: "absent2@example.test" });

    await testDb.systemSetting.upsert({
      where: { key: "manager_participation_summary" },
      create: {
        key: "manager_participation_summary",
        value: "true",
        description: "test",
      },
      update: { value: "true" },
    });

    await testDb.noActivityPeriod.create({
      data: {
        userId: absentUser.id,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-08-12T00:00:00.000Z"),
        markedById: manager.id,
      },
    });

    const result = await teamParticipationToday(
      testDb,
      [absentUser.id],
      new Date("2026-08-21T09:00:00.000Z"),
    );

    expect(result).toEqual({ people: 1, wrote: 0 });
  });
});
