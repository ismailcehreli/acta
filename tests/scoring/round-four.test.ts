import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createActivity as createActivityService } from "@/server/activities/write";
import { approveActivity } from "@/server/activities/approval";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrend } from "@/server/scoring/read";
import {
  SCORE_CALCULATORS,
  SCORE_FORMULA_VERSION,
} from "@/server/scoring/compute";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

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

async function setupScene(createdAt = "2026-01-01T00:00:00.000Z") {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({
    name: "Tooling Shop",
    parentId: root.id,
    requiresApproval: false,
  });
  const employee = await createUser(unit.id, { fullName: "Worker Kadir" });
  await testDb.user.update({
    where: { id: employee.id },
    data: { createdAt: new Date(createdAt) },
  });
  return { root, unit, employee };
}

describe("Package 8 round four counterexamples", () => {
  it("activity accepted late into frozen month produces new score revision", async () => {
    const { unit, employee } = await setupScene();
    await createActivity(employee, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(1);

    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    const lateActivity = await createActivityService(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Late but compliant",
        description: "New setting accepts this date.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );
    expect(lateActivity.ok).toBe(true);

    await closeScorePeriod(testDb, new Date("2026-08-03T06:01:00.000Z"));

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      }),
      "old scorecard preserved, correction becomes revision 2",
    ).toBe(2);

    const latest = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "desc" },
      select: { revisionNo: true, total: true },
    });
    const trend = await readScoreTrend(
      testDb,
      { id: employee.id, isSystemAdmin: false },
      employee.id,
    );
    expect(latest.revisionNo).toBe(2);
    expect(trend.periods).toEqual([
      { periodStart: "2026-07-01", total: latest.total },
    ]);
  });

  it("worker inactive for two months catches up all eligible missing months in chronological order", async () => {
    const { employee } = await setupScene("2026-07-01T00:00:00.000Z");
    await testDb.scoreHistoryControl.create({
      data: { id: 1, historyStart: new Date("2026-07-01") },
    });

    for (const dateStr of ["2026-07-15", "2026-08-17", "2026-09-15"]) {
      await createActivity(employee, {
        activityDate: new Date(`${dateStr}T00:00:00.000Z`),
      });
    }

    const now = new Date("2026-10-10T06:00:00.000Z");
    await closeScorePeriod(testDb, now);
    await closeScorePeriod(testDb, now);
    await closeScorePeriod(testDb, now);

    const periods = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, frozen: true },
      orderBy: { periodStart: "asc" },
      select: { periodStart: true },
    });
    expect(periods.map((d) => d.periodStart.toISOString().slice(0, 10))).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("90-day active setting does not permanently skip past eligible month", async () => {
    const { employee } = await setupScene("2026-07-01T00:00:00.000Z");
    await testDb.scoreHistoryControl.create({
      data: { id: 1, historyStart: new Date("2026-07-01") },
    });
    await createActivity(employee, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "90",
        effectiveAt: new Date("2026-07-31T20:59:00.000Z"),
        reason: "TEST_PERIOD_END_SETTING",
      },
    });

    const result = await closeScorePeriod(
      testDb,
      new Date("2026-11-01T06:00:00.000Z"),
    );
    expect(result.periodStart).toBe("2026-07-01");
  });

  it("denominator of user joining mid-period begins on hire date", async () => {
    const { employee } = await setupScene("2026-07-20T09:00:00.000Z");

    await closeScorePeriod(testDb, new Date("2026-08-25T12:00:00.000Z"));

    const period = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      select: { expectedDays: true },
    });
    expect(period.expectedDays).toBe(10);
  });

  it("closing actually invokes registered calculator for written version", async () => {
    const { employee } = await setupScene();
    const original = SCORE_CALCULATORS[SCORE_FORMULA_VERSION];
    const calculator = vi.fn(() => ({
      regularity: 1,
      acceptance: null,
      approval: null,
      followUp: 6,
      total: 7,
    }));
    SCORE_CALCULATORS[SCORE_FORMULA_VERSION] = calculator;

    try {
      await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
      const period = await testDb.userScorePeriod.findFirstOrThrow({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
        select: { total: true, formulaVersion: true },
      });

      expect(calculator).toHaveBeenCalledOnce();
      expect(period).toEqual({ total: 7, formulaVersion: SCORE_FORMULA_VERSION });
    } finally {
      SCORE_CALCULATORS[SCORE_FORMULA_VERSION] = original;
    }
  });

  it("period closed with V2 carries V2 result and tag together", async () => {
    const { root, employee } = await setupScene();
    const manager = await createUser(root.id, {
      fullName: "General Manager",
      isUnitManager: true,
      isScored: false,
      writesActivities: false,
    });
    const v2 = vi.fn(() => ({
      regularity: 2,
      acceptance: null,
      approval: null,
      followUp: 6,
      total: 8,
    }));
    const originalV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = v2;

    try {
      await closeScorePeriod(
        testDb,
        new Date("2026-08-02T06:00:00.000Z"),
        { formulaVersion: 2 },
      );
      const period = await testDb.userScorePeriod.findFirstOrThrow({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
        select: { total: true, formulaVersion: true },
      });
      expect(v2).toHaveBeenCalledOnce();
      expect(period).toEqual({ total: 8, formulaVersion: 2 });

      const trend = await readScoreTrend(
        testDb,
        { id: employee.id, isSystemAdmin: false },
        employee.id,
      );
      expect(trend.periods).toEqual([{ periodStart: "2026-07-01", total: 8 }]);
      const managerTrend = await readScoreTrend(
        testDb,
        { id: manager.id, isSystemAdmin: false },
        employee.id,
      );
      expect(managerTrend.periods).toEqual([
        { periodStart: "2026-07-01", total: 8 },
      ]);
    } finally {
      SCORE_CALCULATORS[2] = originalV2;
    }
  });
});

describe("transactional safety of score recalculation queue", () => {
  it("decision racing with first closing is neither dropped from initial version nor queue", async () => {
    const root = await createOrgUnit({ name: "Race Company", type: "Root" });
    const unit = await createOrgUnit({
      name: "Race Unit",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(root.id, {
      fullName: "Race Manager",
      isUnitManager: true,
      isScored: false,
      writesActivities: false,
    });
    const employee = await createUser(unit.id, { fullName: "Race Employee" });
    await testDb.user.update({
      where: { id: employee.id },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    const activity = await createActivityService(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: "2026-07-15",
        title: "Decision racing with closing",
        description: "Decision must not fall between two score versions.",
        targetDepartmentIds: [],
      },
      new Date("2026-07-15T09:00:00.000Z"),
    );
    if (!activity.ok) throw new Error(activity.message);

    let resolveCloseReady = () => {};
    const closeReady = new Promise<void>((done) => (resolveCloseReady = done));
    let resolveReleaseClose = () => {};
    const releaseClose = new Promise<void>((done) => (resolveReleaseClose = done));

    const barrierCloseDb = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) => {
          let firstLock = true;
          const proxy = new Proxy(tx, {
            get(target, prop) {
              if (prop !== "$executeRaw") {
                const val = Reflect.get(target, prop);
                return typeof val === "function" ? val.bind(target) : val;
              }

              const original = Reflect.get(target, prop) as (
                ...args: unknown[]
              ) => Promise<unknown>;
              return async (...args: unknown[]) => {
                const result = await original.apply(target, args);
                if (firstLock) {
                  firstLock = false;
                  resolveCloseReady();
                  await releaseClose;
                }
                return result;
              };
            },
          });
          return fn(proxy);
        })) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    const secondClient = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    let resolveDecisionPidReady!: (pid: number) => void;
    const decisionPidReady = new Promise<number>((done) => (resolveDecisionPidReady = done));
    const pidTrackingDb = {
      ...secondClient,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        secondClient.$transaction(async (tx) => {
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid()::int AS pid
          `;
          if (!row) throw new Error("Could not read pid for decision connection.");
          resolveDecisionPidReady(row.pid);
          return fn(tx);
        })) as typeof secondClient.$transaction,
    } as unknown as typeof secondClient;

    let closePromise: ReturnType<typeof closeScorePeriod> | null = null;
    let decisionPromise: ReturnType<typeof approveActivity> | null = null;
    try {
      closePromise = closeScorePeriod(
        barrierCloseDb,
        new Date("2026-08-02T06:00:00.000Z"),
      );
      await closeReady;

      decisionPromise = approveActivity(
        pidTrackingDb,
        manager.id,
        activity.activity.id,
        new Date("2026-08-02T06:00:01.000Z"),
      );
      const decisionPid = await decisionPidReady;

      let advisoryWaiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await testDb.$queryRaw<Array<{ isWaiting: boolean }>>`
          SELECT ("wait_event_type" = 'Lock' AND "wait_event" = 'advisory') AS "isWaiting"
          FROM pg_stat_activity
          WHERE pid = ${decisionPid}
        `;
        if (row?.isWaiting) {
          advisoryWaiting = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(advisoryWaiting).toBe(true);

      resolveReleaseClose();
      await closePromise;
      expect((await decisionPromise).ok).toBe(true);
    } finally {
      resolveReleaseClose();
      const cleanup: Promise<unknown>[] = [];
      if (closePromise) cleanup.push(closePromise);
      if (decisionPromise) cleanup.push(decisionPromise);
      await Promise.allSettled(cleanup);
      await secondClient.$disconnect();
    }

    const pendingRequest =
      await testDb.scoreRecalculationRequest.findFirstOrThrow({
        where: { processedAt: null },
        select: { id: true },
      });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:01:00.000Z"));
    const revisions = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, sourceRequestId: true },
    });
    expect(revisions).toEqual([
      { revisionNo: 1, sourceRequestId: null },
      { revisionNo: 2, sourceRequestId: pendingRequest.id },
    ]);
    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: pendingRequest.id },
        select: { processedAt: true },
      }),
    ).toEqual({ processedAt: expect.any(Date) });
  });

  it("if queue cannot be written, late activity is also not created", async () => {
    const { unit, employee } = await setupScene();
    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });

    const failingQueueDb = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                if (prop === "scoreRecalculationRequest") {
                  return {
                    upsert: async () => {
                      throw new Error("score queue write failed");
                    },
                  };
                }
                return Reflect.get(target, prop);
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    await expect(
      createActivityService(
        failingQueueDb,
        { id: employee.id, orgUnitId: unit.id, requiresApproval: false },
        {
          activityDate: "2026-07-31",
          title: "Activity that should not remain partial",
          description: "If queue write fails, this record is rolled back.",
          targetDepartmentIds: [],
        },
        new Date("2026-08-03T06:00:00.000Z"),
      ),
    ).rejects.toThrow("score queue write failed");

    expect(
      await testDb.activity.count({
        where: { title: "Activity that should not remain partial" },
      }),
    ).toBe(0);
    expect(await testDb.scoreRecalculationRequest.count()).toBe(0);
  });

  it("if recalculation crashes, old revision remains visible and request is retried", async () => {
    const { unit, employee } = await setupScene();
    await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
      { formulaVersion: 1 },
    );
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    await createActivityService(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Activity to be retried",
        description: "First calculation crashes, second succeeds.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );

    const original = SCORE_CALCULATORS[1];
    SCORE_CALCULATORS[1] = () => {
      throw new Error("calculator temporarily unavailable");
    };
    try {
      await expect(
        closeScorePeriod(
          testDb,
          new Date("2026-08-03T06:01:00.000Z"),
          { formulaVersion: 1 },
        ),
      ).rejects.toThrow("calculator temporarily unavailable");
    } finally {
      SCORE_CALCULATORS[1] = original;
    }

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(1);
    const pending = await testDb.scoreRecalculationRequest.findFirstOrThrow();
    expect(pending).toMatchObject({ attempts: 1, processedAt: null });
    expect(pending.lastError).toContain(
      "calculator temporarily unavailable",
    );

    await closeScorePeriod(testDb, new Date("2026-08-03T06:02:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(2);
    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: pending.id },
        select: { attempts: true, processedAt: true, lastError: true },
      }),
    ).toMatchObject({ attempts: 2, lastError: null });
  });

  it("error is recorded to genuinely processed request not to stale request seen before transaction", async () => {
    const { unit, employee } = await setupScene();
    await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
      { formulaVersion: 1 },
    );
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });

    const staleRequest = await testDb.scoreRecalculationRequest.create({
      data: {
        userId: employee.id,
        periodStart: new Date("2026-07-01"),
        sourceType: "TEST_PROCESSED",
        sourceId: "already-finished",
        requestedAt: new Date("2026-08-03T05:00:00.000Z"),
        processedAt: new Date("2026-08-03T05:01:00.000Z"),
        attempts: 1,
      },
    });
    await createActivityService(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Genuine pending request",
        description: "Error must be written to this request.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );
    const realRequest = await testDb.scoreRecalculationRequest.findFirstOrThrow({
      where: { processedAt: null },
    });

    // Old application read queue ID before transaction lock.
    // This wrapper returns an already-finished row to that exact pre-read;
    // the genuine request being processed appears only inside the transaction query.
    const stalePreReadDb = {
      ...testDb,
      scoreRecalculationRequest: {
        findFirst: async () => ({ id: staleRequest.id }),
        updateMany: (...args: Parameters<typeof testDb.scoreRecalculationRequest.updateMany>) =>
          testDb.scoreRecalculationRequest.updateMany(...args),
      },
    } as unknown as typeof testDb;

    const original = SCORE_CALCULATORS[1];
    SCORE_CALCULATORS[1] = () => {
      throw new Error("processed request crashed");
    };
    try {
      await expect(
        closeScorePeriod(
          stalePreReadDb,
          new Date("2026-08-03T06:01:00.000Z"),
          { formulaVersion: 1 },
        ),
      ).rejects.toThrow("processed request crashed");
    } finally {
      SCORE_CALCULATORS[1] = original;
    }

    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: realRequest.id },
        select: { attempts: true, lastError: true },
      }),
    ).toMatchObject({ attempts: 1 });
    expect(
      (
        await testDb.scoreRecalculationRequest.findUniqueOrThrow({
          where: { id: realRequest.id },
          select: { lastError: true },
        })
      ).lastError,
    ).toContain("processed request crashed");
  });

  it("two workers produce only one new revision from the same recalculation request", async () => {
    const { unit, employee } = await setupScene();
    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    await createActivityService(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Single correction revision",
        description: "Two workers must not double write the same request.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );

    const secondClient = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    try {
      const results = await Promise.allSettled([
        closeScorePeriod(testDb, new Date("2026-08-03T06:01:00.000Z")),
        closeScorePeriod(secondClient, new Date("2026-08-03T06:01:00.000Z")),
      ]);
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    } finally {
      await secondClient.$disconnect();
    }

    const revisions = await testDb.userScorePeriod.findMany({
      where: { userId: employee.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true },
    });
    expect(revisions).toEqual([{ revisionNo: 1 }, { revisionNo: 2 }]);
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { processedAt: null },
      }),
    ).toBe(0);
  });
});
