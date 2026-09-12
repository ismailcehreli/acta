import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelNoActivityPeriod, markNoActivityPeriod } from "@/server/absence/service";
import { approveActivity } from "@/server/activities/approval";
import { cancelActivity } from "@/server/activities/cancel";
import { createActivity } from "@/server/activities/write";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Permission races tests.
// Ensures authorization is verified within the transaction lock and not based on stale pre-checks.

const WITHIN_LEAVE = new Date("2026-08-22T09:00:00.000Z");

const clientA = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientB = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});
const clientC = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  log: [],
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([
    testDb.$disconnect(),
    clientA.$disconnect(),
    clientB.$disconnect(),
    clientC.$disconnect(),
  ]);
});

/**
 * Locks an activity record and exposes a release callback.
 */
async function holdLock(
  client: PrismaClient,
  activityId: string,
): Promise<{ release: () => void; done: Promise<void> }> {
  let release!: () => void;
  let lockAcquired!: () => void;

  const lockReady = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const done = client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "Activity" WHERE "id" = ${activityId} FOR UPDATE`;
      lockAcquired();
      await gate;
    },
    { timeout: 15_000 },
  );

  await lockReady;
  return { release, done };
}

/**
 * Observes until a connection begins waiting on a lock in pg_locks.
 */
async function waitForLockWait(
  client: PrismaClient,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const [row] = await client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
    `;
    if ((row?.n ?? 0) > 0) return;
    if (Date.now() > deadline) {
      throw new Error("No waiting connection observed: race setup timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function setupCompany() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  const tooling = await createOrgUnit({
    name: "Tooling Department",
    parentId: root.id,
    requiresApproval: true,
  });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: root.id });
  const paintShop = await createOrgUnit({ name: "Paint Department", parentId: root.id });

  const generalManager = await createUser(root.id, {
    email: "gm@example.test",
    isUnitManager: true,
  });
  const toolingManager = await createUser(tooling.id, {
    email: "tooling-mgr@example.test",
    isUnitManager: true,
  });
  const toolingWorker = await createUser(tooling.id, { email: "worker@example.test" });
  const planningManager = await createUser(planning.id, {
    email: "planning-mgr@example.test",
    isUnitManager: true,
  });

  return { root, tooling, planning, paintShop, generalManager, toolingManager, toolingWorker, planningManager };
}

async function writeRecord(
  author: { id: string; orgUnitId: string },
  now: Date,
  requiresApproval: boolean,
) {
  const result = await createActivity(
    testDb,
    { id: author.id, orgUnitId: author.orgUnitId, requiresApproval },
    {
      activityDate: now.toISOString().slice(0, 10),
      title: "Tooling maintenance",
      description: "Maintenance performed across 3 presses.",
      targetDepartmentIds: [],
    },
    now,
  );

  if (!result.ok) throw new Error(`write failed: ${result.error}`);
  return result.activity;
}

describe("delegation authority re-verified at decision time", () => {
  it("rejects approval if delegation was cancelled while waiting on lock", async () => {
    const org = await setupCompany();
    const period = await markNoActivityPeriod(
      testDb,
      org.generalManager.id,
      {
        userId: org.toolingManager.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: org.planningManager.id,
      },
      WITHIN_LEAVE,
    );
    if (!period.ok) throw new Error("failed to setup delegation");

    const record = await writeRecord(org.toolingWorker, WITHIN_LEAVE, true);

    // 1) Another client acquires and holds the lock on the activity.
    const lock = await holdLock(clientA, record.id);

    // 2) Deputy attempts approval; performs pre-checks while delegation is active,
    //    then blocks waiting for the row lock.
    const decisionPromise = approveActivity(clientB, org.planningManager.id, record.id, WITHIN_LEAVE);
    await waitForLockWait(testDb);

    // 3) Meanwhile, the general manager cancels the delegation period.
    const cancellation = await cancelNoActivityPeriod(
      clientC,
      org.generalManager.id,
      period.id,
      "Leave cancelled",
      WITHIN_LEAVE,
    );
    expect(cancellation.ok).toBe(true);

    // 4) Row lock is released; deputy's transaction proceeds.
    lock.release();
    await lock.done;

    const decision = await decisionPromise;

    expect(decision.ok).toBe(false);

    const fresh = await testDb.activity.findUniqueOrThrow({ where: { id: record.id } });
    expect(fresh.approvalStatus).toBe("PENDING_APPROVAL");
    expect(fresh.approverId).not.toBe(org.planningManager.id);
    expect(fresh.approvalDecidedAt).toBeNull();
  });

  it("completes normally when delegation remains active", async () => {
    const org = await setupCompany();
    const period = await markNoActivityPeriod(
      testDb,
      org.generalManager.id,
      {
        userId: org.toolingManager.id,
        startDate: "2026-08-20",
        endDate: "2026-08-27",
        deputyId: org.planningManager.id,
      },
      WITHIN_LEAVE,
    );
    if (!period.ok) throw new Error("failed to setup delegation");

    const record = await writeRecord(org.toolingWorker, WITHIN_LEAVE, true);

    const decision = await approveActivity(
      testDb,
      org.planningManager.id,
      record.id,
      WITHIN_LEAVE,
    );

    expect(decision.ok).toBe(true);
  });
});

describe("cancellation authority re-verified at cancellation time", () => {
  it("rejects cancellation if author was transferred while manager was waiting on lock", async () => {
    const org = await setupCompany();
    const record = await writeRecord(org.toolingWorker, WITHIN_LEAVE, false);

    // 1) Another client acquires and holds the activity lock.
    const lock = await holdLock(clientA, record.id);

    // 2) Tooling manager initiates cancellation and blocks on the row lock.
    const cancelPromise = cancelActivity(
      clientB,
      { id: org.toolingManager.id, isSystemAdmin: false },
      record.id,
      "No longer valid",
      WITHIN_LEAVE,
    );
    await waitForLockWait(testDb);

    // 3) Simultaneously, author is transferred to Paint Department (no longer subordinate).
    await clientC.user.update({
      where: { id: org.toolingWorker.id },
      data: { orgUnitId: org.paintShop.id },
    });

    // 4) Release lock and let cancellation proceed.
    lock.release();
    await lock.done;

    const result = await cancelPromise;

    expect(result.ok).toBe(false);

    const fresh = await testDb.activity.findUniqueOrThrow({ where: { id: record.id } });
    expect(fresh.approvalStatus).toBe("APPROVED");
    expect(await testDb.cancellationRecord.count()).toBe(0);
  });

  it("completes cancellation normally when author remains in same department", async () => {
    const org = await setupCompany();
    const record = await writeRecord(org.toolingWorker, WITHIN_LEAVE, false);

    const result = await cancelActivity(
      testDb,
      { id: org.toolingManager.id, isSystemAdmin: false },
      record.id,
      "Incorrect entry",
      WITHIN_LEAVE,
    );

    expect(result.ok).toBe(true);
  });
});
