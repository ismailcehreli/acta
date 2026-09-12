import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildHealthReport } from "@/server/health/report";
import {
  DELAY_FACTOR,
  JOB_NAMES,
  describeJob,
  listJobHealth,
  recordJobFailure,
  recordJobSuccess,
  worstLagSeconds,
} from "@/server/jobs/status";
import { alertOnDelayedJobs } from "@/worker/jobs/alert";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Scheduled job monitoring (§12.4). If the scheduler stops, the system appears to be running
// but processes die silently — this is the most difficult type of failure to detect.

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("delay calculation", () => {
  const base = {
    jobName: "test",
    lastError: null,
    expectedIntervalMinutes: 1,
  };

  it("a job running within the expected interval is not considered delayed", () => {
    const result = describeJob(
      { ...base, lastSuccessAt: new Date(NOW.getTime() - 30_000) },
      NOW,
    );

    expect(result.lagSeconds).toBe(30);
    expect(result.delayed).toBe(false);
  });

  it("is not yet considered delayed at twice the threshold", () => {
    const limit = 1 * 60 * DELAY_FACTOR * 1000;
    const result = describeJob(
      { ...base, lastSuccessAt: new Date(NOW.getTime() - limit) },
      NOW,
    );

    expect(result.delayed).toBe(false);
  });

  it("is considered delayed when twice the threshold is exceeded", () => {
    const limit = 1 * 60 * DELAY_FACTOR * 1000;
    const result = describeJob(
      { ...base, lastSuccessAt: new Date(NOW.getTime() - limit - 1000) },
      NOW,
    );

    expect(result.delayed).toBe(true);
  });

  it("a job that has never run is considered delayed", () => {
    const result = describeJob({ ...base, lastSuccessAt: null }, NOW);

    // "Never ran" is not a healthy state, it is a failure.
    expect(result.lagSeconds).toBeNull();
    expect(result.delayed).toBe(true);
  });

  it("threshold extends if the expected interval is longer", () => {
    const result = describeJob(
      {
        ...base,
        expectedIntervalMinutes: 60,
        lastSuccessAt: new Date(NOW.getTime() - 90 * 60_000),
      },
      NOW,
    );

    // 90 minutes is below twice the threshold (120 min) of an hourly job.
    expect(result.delayed).toBe(false);
  });
});

describe("heartbeat recording", () => {
  it("success is recorded and previous error is cleared", async () => {
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "No SMTP");
    await recordJobSuccess(testDb, JOB_NAMES.notificationDispatch, NOW);

    const record = await testDb.scheduledJobStatus.findUniqueOrThrow({
      where: { jobName: JOB_NAMES.notificationDispatch },
    });
    expect(record.lastSuccessAt).toEqual(NOW);
    expect(record.lastError).toBeNull();
  });

  it("error does not delete last successful run timestamp", async () => {
    await recordJobSuccess(testDb, JOB_NAMES.notificationDispatch, NOW);
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "connection dropped");

    const record = await testDb.scheduledJobStatus.findUniqueOrThrow({
      where: { jobName: JOB_NAMES.notificationDispatch },
    });
    // Delay calculation depends on this; error must not delete it.
    expect(record.lastSuccessAt).toEqual(NOW);
    expect(record.lastError).toBe("connection dropped");
  });

  it("a job with no record at all appears in list and is considered delayed", async () => {
    const jobs = await listJobHealth(testDb, NOW);

    expect(jobs).toHaveLength(Object.values(JOB_NAMES).length);
    expect(jobs.every((job) => job.delayed)).toBe(true);
    // A job not appearing in the list would be assumed healthy.
    expect(jobs.map((j) => j.jobName)).toContain(JOB_NAMES.overdueAnswerReminder);
  });

  it("worst lag is reported", async () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }
    await recordJobSuccess(
      testDb,
      JOB_NAMES.notificationDispatch,
      new Date(NOW.getTime() - 45_000),
    );

    const jobs = await listJobHealth(testDb, NOW);
    expect(worstLagSeconds(jobs)).toBe(45);
  });
});

describe("delay alert (§12.4)", () => {
  async function systemAdmin(email?: string) {
    // Tree can only have one root; second call uses the existing root.
    const existing = await testDb.orgUnit.findFirst({ where: { parentId: null } });
    const unit = existing ?? (await createOrgUnit({ name: "Company", type: "Root" }));

    return createUser(unit.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
      ...(email ? { email } : {}),
    });
  }

  it("no alert is queued if there is no delay", async () => {
    await systemAdmin();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }

    const result = await alertOnDelayedJobs(testDb, NOW);

    expect(result.delayedJobs).toEqual([]);
    expect(result.queued).toBe(0);
  });

  it("alert is queued for system admin for delayed job", async () => {
    const admin = await systemAdmin();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }
    await recordJobSuccess(
      testDb,
      JOB_NAMES.notificationDispatch,
      new Date(NOW.getTime() - 10 * 60_000),
    );

    const result = await alertOnDelayedJobs(testDb, NOW);

    expect(result.delayedJobs).toEqual([JOB_NAMES.notificationDispatch]);
    expect(result.queued).toBe(1);
    const queue = await testDb.notificationQueue.findMany({
      where: { eventType: "job_delayed" },
    });
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe(admin.id);
  });

  it("second alert is not queued on same day, repeats the next day", async () => {
    await systemAdmin();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 60 * 60_000));
    }

    const first = await alertOnDelayedJobs(testDb, NOW);
    const monitoredJobCount = Object.values(JOB_NAMES).length - 1;
    expect(first.queued).toBe(monitoredJobCount);

    // Same day: does not flood within 24h default repeat interval.
    const second = await alertOnDelayedJobs(
      testDb,
      new Date("2026-08-18T12:30:00.000Z"),
    );
    expect(second.queued).toBe(0);

    // Next day: warning repeats if failure persists.
    const nextDay = await alertOnDelayedJobs(
      testDb,
      new Date("2026-08-19T12:00:00.000Z"),
    );
    expect(nextDay.queued).toBe(monitoredJobCount);
  });

  it("alert is not sent to inactive system admin", async () => {
    // It is no longer possible for a company to have **no** active system admin
    // (database invariant, finding 6): last admin's permissions cannot be removed
    // and cannot be deactivated. Therefore, what is tested is not "goes to no one",
    // but **only goes to active admins**.
    const active = await systemAdmin();
    const inactive = await systemAdmin("inactive-admin@example.test");

    await testDb.user.update({
      where: { id: inactive.id },
      data: { isActive: false, isUnitManager: false },
    });

    const result = await alertOnDelayedJobs(testDb, NOW);

    expect(result.delayedJobs.length).toBeGreaterThan(0);
    expect(result.queued).toBe(result.delayedJobs.length);

    // Inactive admin's queue has nothing; active admin's has.
    expect(await testDb.notificationQueue.count({ where: { userId: inactive.id } })).toBe(0);
    expect(
      await testDb.notificationQueue.count({ where: { userId: active.id } }),
    ).toBeGreaterThan(0);
  });

  it("never-taken backup does not produce alert when backup monitoring is disabled", async () => {
    const admin = await systemAdmin();
    for (const jobName of Object.values(JOB_NAMES)) {
      if (jobName !== JOB_NAMES.backup) {
        await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
      }
    }

    const disabled = await alertOnDelayedJobs(testDb, NOW);
    expect(disabled.delayedJobs).not.toContain(JOB_NAMES.backup);
    expect(disabled.queued).toBe(0);

    await saveSettings(testDb, {
      [SETTING_KEYS.backupMonitoringEnabled]: "true",
    });

    const enabled = await alertOnDelayedJobs(testDb, NOW);
    expect(enabled.delayedJobs).toEqual([JOB_NAMES.backup]);
    expect(enabled.queued).toBe(1);
    expect(
      await testDb.notificationQueue.count({ where: { userId: admin.id } }),
    ).toBe(1);
  });

  it("delay alert can be disabled completely", async () => {
    await systemAdmin();
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "handler stopped");
    await saveSettings(testDb, {
      [SETTING_KEYS.jobDelayAlertEnabled]: "false",
    });

    const result = await alertOnDelayedJobs(testDb, NOW);

    expect(result).toEqual({ delayedJobs: [], queued: 0 });
    expect(await testDb.notificationQueue.count()).toBe(0);
  });
});

describe("health report relies on real data", () => {
  it("measures queue depth and lag", async () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }

    const report = await buildHealthReport({
      pingDatabase: async () => undefined,
      now: () => NOW,
      queueDepth: async () => 7,
      schedulerLag: async () => ({ lagSeconds: 10, delayed: false }),
    });

    expect(report.status).toBe("ok");
    expect(report.notificationQueue).toEqual({
      status: "ok",
      depth: 7,
      source: "live",
    });
    expect(report.scheduler).toEqual({
      status: "ok",
      lagSeconds: 10,
      source: "live",
    });
  });

  it("delayed scheduler marks report as 'down'", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => undefined,
      now: () => NOW,
      queueDepth: async () => 0,
      schedulerLag: async () => ({ lagSeconds: 900, delayed: true }),
    });

    // When the scheduler stops, the system must not continue claiming to be "running".
    expect(report.scheduler.status).toBe("down");
    expect(report.status).toBe("down");
  });

  it("does not attempt other metrics if database is down", async () => {
    let queueQueried = false;

    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error("no connection");
      },
      now: () => NOW,
      queueDepth: async () => {
        queueQueried = true;
        return 0;
      },
      schedulerLag: async () => ({ lagSeconds: 0, delayed: false }),
    });

    expect(queueQueried).toBe(false);
    expect(report.status).toBe("down");
    expect(report.notificationQueue.source).toBe("placeholder");
  });
});

describe("backup job (§15.6)", () => {
  it("is monitored with daily interval, not minute threshold", async () => {
    const jobs = await listJobHealth(testDb, NOW);
    const backup = jobs.find((job) => job.jobName === JOB_NAMES.backup);

    expect(backup).toBeDefined();
    // Checking a daily backup with a 1-minute threshold would alert on every round.
    expect(backup?.expectedIntervalMinutes).toBe(24 * 60);
  });

  it("exceeds alert threshold when backup is delayed by 48 hours", async () => {
    await recordJobSuccess(
      testDb,
      JOB_NAMES.backup,
      new Date(NOW.getTime() - 47 * 3_600_000),
      24 * 60,
    );

    let jobs = await listJobHealth(testDb, NOW);
    expect(jobs.find((j) => j.jobName === JOB_NAMES.backup)?.delayed).toBe(false);

    await recordJobSuccess(
      testDb,
      JOB_NAMES.backup,
      new Date(NOW.getTime() - 49 * 3_600_000),
      24 * 60,
    );

    jobs = await listJobHealth(testDb, NOW);
    // Missing backup does not pass silently: falls into existing alert path (§12.4).
    expect(jobs.find((j) => j.jobName === JOB_NAMES.backup)?.delayed).toBe(true);
  });
});
