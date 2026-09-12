import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";
import { openFollowUp } from "@/server/follow-ups/service";
import { DEMO_EMAIL_DOMAIN, DEMO_UNIT_NAMES, installDemoData } from "@/server/demo/data";
import {
  DEMO_ORIGIN_REUSED,
  rememberDemoOrgUnitOrigin,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";
import { listPendingApprovals } from "@/server/activities/approval";

import {
  createActivity as createActivityFixture,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Demo data must establish invariants matching production behavior.
// Pending activities must have valid approvers and open approval rounds
// so they can be viewed in the queue and decided upon.

const NOW = new Date("2026-08-20T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Setup demo company with root unit and system administrator. */
async function setupDemoCompany() {
  const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
  await createUser(root.id, {
    fullName: "System Administrator",
    email: "admin@company.test",
    isSystemAdmin: true,
  });

  const result = await installDemoData(testDb);
  if (!result.ok) throw new Error(`Demo data installation failed: ${result.error}`);
}

describe("demo data approval flow", () => {
  it("pending demo record appears in queue and can be approved", async () => {
    await setupDemoCompany();

    const pending = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true, approverId: true },
    });

    // Queue uses approvalQueueWhere: if approver list is missing, record does not appear
    const queue = await listPendingApprovals(testDb, pending.approverId!, NOW);
    expect(queue.map((item) => item.id)).toContain(pending.id);

    // Decision service requires open round; demo data uses real time
    const decision = await approveActivity(
      testDb,
      pending.approverId!,
      pending.id,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(decision.ok).toBe(true);
  });

  it("can be purged from admin panel immediately after installation", async () => {
    await setupDemoCompany();

    const admin = await testDb.user.findFirstOrThrow({
      where: { email: { endsWith: "@company.test" } },
      select: { id: true },
    });

    const purgeResult = await purgeDemoData(testDb, admin.id, new Date());

    if (!purgeResult.ok) {
      throw new Error(
        `Purge failed: ${purgeResult.error} ${"detail" in purgeResult ? purgeResult.detail : ""}`,
      );
    }

    expect(await testDb.approvalRound.count()).toBe(0);
    expect(
      await testDb.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }),
    ).toBe(0);
    expect(
      await testDb.orgUnit.count({
        where: { name: { in: [...DEMO_UNIT_NAMES] } },
      }),
    ).toBe(0);
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("pending activity appears in both managers' queues in dual-manager unit", async () => {
    await setupDemoCompany();

    const pending = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true, authorId: true },
    });

    const author = await testDb.user.findUniqueOrThrow({
      where: { id: pending.authorId },
      select: { orgUnitId: true },
    });

    // Add a second manager to the same unit
    const secondManager = await createUser(author.orgUnitId, {
      fullName: "Second Manager",
      email: `second.manager@${DEMO_EMAIL_DOMAIN}`,
      isUnitManager: true,
    });

    // Re-run installer to supplement demo data
    const retry = await installDemoData(testDb);
    expect(retry.ok).toBe(true);

    const queue = await listPendingApprovals(testDb, secondManager.id, new Date());
    expect(queue.map((item) => item.id)).toContain(pending.id);
  }, 60_000);

  it("approved demo records decided by manager have approval round history", async () => {
    await setupDemoCompany();

    const decidedRecords = await testDb.activity.findMany({
      where: { approverId: { not: null }, approvalDecidedAt: { not: null } },
      select: { id: true },
    });

    expect(decidedRecords.length).toBeGreaterThan(0);

    const withRounds = await testDb.approvalRound.count({
      where: { activityId: { in: decidedRecords.map((item) => item.id) }, decidedAt: { not: null } },
    });

    expect(withRounds).toBe(decidedRecords.length);
  });

  it("deleted relationships are repaired on second installation", async () => {
    await setupDemoCompany();

    const pending = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true },
    });

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.approvalRound.deleteMany({ where: { activityId: pending.id } });
      await tx.activityApprover.deleteMany({ where: { activityId: pending.id } });
    });

    const retry = await installDemoData(testDb);
    expect(retry.ok).toBe(true);

    expect(
      await testDb.approvalRound.count({ where: { activityId: pending.id } }),
    ).toBeGreaterThan(0);
    expect(
      await testDb.activityApprover.count({ where: { activityId: pending.id } }),
    ).toBeGreaterThan(0);
  });

  it("approval round of demo record written via service does not block purge", async () => {
    const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
    const admin = await createUser(root.id, {
      fullName: "System Administrator",
      email: "admin@company.test",
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const unit = await createOrgUnit({
      name: "Approval Required Unit",
      parentId: root.id,
      requiresApproval: true,
    });
    await rememberDemoOrgUnitOrigin(testDb, unit.id, DEMO_ORIGIN_REUSED);
    await createUser(unit.id, {
      fullName: "Unit Manager",
      email: `manager@${DEMO_EMAIL_DOMAIN}`,
      isUnitManager: true,
    });
    const demoEmployee = await createUser(unit.id, {
      fullName: "Demo Employee",
      email: `employee@${DEMO_EMAIL_DOMAIN}`,
    });

    // Write activity via service pathway
    const created = await createActivity(
      testDb,
      { id: demoEmployee.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: new Date().toISOString().slice(0, 10),
        title: "Demo record written via service",
        description: "Purge should be able to remove this record as well.",
        targetDepartmentIds: [unit.id],
      },
      new Date(),
    );
    if (!created.ok) throw new Error(`Activity creation failed: ${created.error}`);

    expect(await testDb.approvalRound.count()).toBe(1);

    const purgeResult = await purgeDemoData(testDb, admin.id, new Date());

    if (!purgeResult.ok) {
      throw new Error(
        `Purge failed: ${purgeResult.error} ${"detail" in purgeResult ? purgeResult.detail : ""}`,
      );
    }
    expect(await testDb.approvalRound.count()).toBe(0);
  });
});

describe("purge race condition with real manager decision", () => {
  it("real decision made after pre-check is not deleted", async () => {
    const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
    const admin = await createUser(root.id, {
      fullName: "System Administrator",
      email: "admin@company.test",
      isSystemAdmin: true,
    });
    const unit = await createOrgUnit({
      name: "Approval Required Unit",
      parentId: root.id,
      requiresApproval: true,
    });
    await rememberDemoOrgUnitOrigin(testDb, unit.id, DEMO_ORIGIN_REUSED);

    // Real manager: not on demo domain
    const realManager = await createUser(unit.id, {
      fullName: "Real Manager",
      email: "manager@company.test",
      isUnitManager: true,
    });
    const demoEmployee = await createUser(unit.id, {
      fullName: "Demo Employee",
      email: `employee@${DEMO_EMAIL_DOMAIN}`,
    });

    const created = await createActivity(
      testDb,
      { id: demoEmployee.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: new Date().toISOString().slice(0, 10),
        title: "Racing demo record",
        description: "Will be decided between pre-check and deletion.",
        targetDepartmentIds: [unit.id],
      },
      new Date(),
    );
    if (!created.ok) throw new Error(`Activity creation failed: ${created.error}`);

    // Pause purge execution right before deletion
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    let releaseHold = () => {};
    const hold = new Promise<void>((resolve) => (releaseHold = resolve));

    const barrierDb = new Proxy(testDb, {
      get(target, prop) {
        if (prop !== "$transaction") {
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        }

        const original = Reflect.get(target, prop) as (
          fn: (tx: unknown) => Promise<unknown>,
        ) => Promise<unknown>;

        return (fn: (tx: unknown) => Promise<unknown>) =>
          original.call(target, async (tx: unknown) => {
            markReady();
            await hold;
            return fn(tx);
          });
      },
    }) as unknown as typeof testDb;

    const purgePromise = purgeDemoData(barrierDb, admin.id, new Date());
    await ready;

    // Real manager approves in this exact race window
    const decision = await approveActivity(
      testDb,
      realManager.id,
      created.activity.id,
      new Date(Date.now() + 60 * 1000),
    );
    expect(decision.ok).toBe(true);

    releaseHold();
    const purgeResult = await purgePromise;

    // Purge must stop: decision history of a real manager must never be deleted
    expect(purgeResult.ok).toBe(false);
    expect(
      await testDb.approvalRound.count({
        where: { decidedById: realManager.id, decidedAt: { not: null } },
      }),
    ).toBe(1);
    expect(
      await testDb.activity.count({ where: { id: created.activity.id } }),
    ).toBe(1);
  });
});

describe("purge protects real data in race conditions", () => {
  it("real follow-up closed after obstacle check is not deleted", async () => {
    const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
    const admin = await createUser(root.id, {
      fullName: "System Administrator",
      email: "admin@company.test",
      isSystemAdmin: true,
    });
    const unit = await createOrgUnit({ name: "Unit", parentId: root.id });
    await rememberDemoOrgUnitOrigin(testDb, unit.id, DEMO_ORIGIN_REUSED);
    const realManager = await createUser(unit.id, {
      fullName: "Real Manager",
      email: "manager@company.test",
      isUnitManager: true,
    });
    const demoEmployee = await createUser(unit.id, {
      fullName: "Demo Employee",
      email: `employee@${DEMO_EMAIL_DOMAIN}`,
    });

    const record = await createActivityFixture(demoEmployee, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    // Follow-up opened by demo employee, will be closed by real manager
    const followUp = await openFollowUp(
      testDb,
      { id: demoEmployee.id, isSystemAdmin: false },
      { activityId: record.id, nextStep: "Pending review" },
      new Date("2026-08-04T09:00:00.000Z"),
    );
    if (!followUp.ok) throw new Error("Follow-up creation failed");

    let closeReady = () => {};
    const closeReadyPromise = new Promise<void>((resolve) => (closeReady = resolve));
    let continueClose = () => {};
    const continuePromise = new Promise<void>((resolve) => (continueClose = resolve));

    const closeTransaction = testDb.$transaction(async (tx) => {
      await tx.followUpItem.update({
        where: { id: followUp.item.id },
        data: {
          status: "CLOSED",
          closedAt: new Date("2026-08-05T09:00:00.000Z"),
          closedById: realManager.id,
          closingNote: "Closed by real manager",
        },
      });
      closeReady();
      await continuePromise;
    });

    await closeReadyPromise;

    const purgePromise = purgeDemoData(testDb, admin.id, new Date());
    await new Promise((resolve) => setTimeout(resolve, 150));
    continueClose();
    await closeTransaction;
    const purgeResult = await purgePromise;

    // Follow-up closed by real manager and its history must remain
    expect(purgeResult.ok).toBe(false);
    expect(
      await testDb.followUpItem.count({ where: { id: followUp.item.id } }),
    ).toBe(1);
  });

  it("pre-existing real org unit with same name is preserved", async () => {
    const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
    const admin = await createUser(root.id, {
      fullName: "System Administrator",
      email: "admin@company.test",
      isSystemAdmin: true,
    });

    // Pre-existing empty unit with name matching demo data
    const existingUnit = await createOrgUnit({
      name: "Production Planning",
      parentId: root.id,
    });

    const installResult = await installDemoData(testDb);
    expect(installResult.ok).toBe(true);

    const purgeResult = await purgeDemoData(testDb, admin.id, new Date());
    expect(purgeResult.ok).toBe(true);

    // Existing unit was reused, not created by demo; purge must not delete it
    expect(
      await testDb.orgUnit.count({ where: { id: existingUnit.id } }),
    ).toBe(1);
  });
});
