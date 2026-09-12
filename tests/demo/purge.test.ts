import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/server/audit/log";
import { DEMO_EMAIL_DOMAIN } from "@/server/demo/data";
import {
  DEMO_ORIGIN_REUSED,
  rememberDemoOrgUnitOrigin,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Demo data purge tests.
// Purge is a deliberate and narrow exception to the "no physical delete" principle.
// These tests verify that real user data is never touched or lost.

const NOW = new Date("2026-08-21T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Small scenario setup: one demo user, one real user, and an activity written by demo user.
 */
async function setupScenario() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  await rememberDemoOrgUnitOrigin(testDb, root.id, DEMO_ORIGIN_REUSED);

  const admin = await createUser(root.id, {
    email: "admin@company.test",
    isSystemAdmin: true,
    isUnitManager: true,
  });
  const realUser = await createUser(root.id, { email: "real.user@company.test" });
  const demoUser = await createUser(root.id, { email: `demo@${DEMO_EMAIL_DOMAIN}` });

  const demoActivity = await createActivity(demoUser, { approvalStatus: "APPROVED" });

  return { root, admin, realUser, demoUser, demoActivity };
}

describe("purge never touches real data", () => {
  it("nothing is deleted if a real user message exists on demo activity", async () => {
    const { admin, realUser, demoUser, demoActivity } = await setupScenario();

    // Real user asked a question on demo activity
    const conversation = await testDb.conversation.create({
      data: {
        activityId: demoActivity.id,
        askerId: realUser.id,
        responsibleId: demoUser.id,
      },
    });
    await testDb.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: realUser.id,
        text: "Why does this tooling issue persist?",
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error !== "blocked") throw new Error("Expected purge to be blocked");
    expect(result.detail).toContain("conversation message");

    // Nothing was deleted
    expect(await testDb.conversationMessage.count()).toBe(1);
    expect(await testDb.activity.count({ where: { id: demoActivity.id } })).toBe(1);
    expect(await testDb.user.count({ where: { id: demoUser.id } })).toBe(1);
  });

  it("nothing is deleted if an audit log points to a real object", async () => {
    const { admin, realUser, demoUser } = await setupScenario();

    // Demo user performed an action on a real user
    await testDb.auditLog.create({
      data: {
        userId: demoUser.id,
        objectType: "user",
        objectId: realUser.id,
        action: AUDIT_ACTIONS.userUpdated,
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error !== "blocked") throw new Error("Expected purge to be blocked");
    expect(result.detail).toContain("audit record");

    // Audit logs are immutable
    expect(await testDb.auditLog.count({ where: { objectId: realUser.id } })).toBe(1);
  });

  it("nothing is deleted if demo user is deputy on real user leave record", async () => {
    const { admin, realUser, demoUser } = await setupScenario();

    await testDb.noActivityPeriod.create({
      data: {
        userId: realUser.id,
        startDate: new Date("2026-08-20T00:00:00.000Z"),
        endDate: new Date("2026-08-25T00:00:00.000Z"),
        markedById: demoUser.id,
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error !== "blocked") throw new Error("Expected purge to be blocked");
    expect(result.detail).toContain("leave record");
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("nothing is deleted if attachment was uploaded by real user", async () => {
    const { admin, realUser, demoActivity } = await setupScenario();

    await testDb.attachment.create({
      data: {
        activityId: demoActivity.id,
        originalName: "report.pdf",
        storedName: "stored-real",
        storagePath: "gs/stored-real",
        sizeBytes: 10,
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        uploadedById: realUser.id,
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error !== "blocked") throw new Error("Expected purge to be blocked");
    expect(result.detail).toContain("attachment");
    expect(await testDb.attachment.count()).toBe(1);
  });
});

describe("clean purge completes successfully", () => {
  it("deletes demo data and leaves audit log when only demo data exists", async () => {
    const { admin, demoUser, demoActivity } = await setupScenario();

    // Audit log created by demo user on demo activity
    await testDb.auditLog.create({
      data: {
        userId: demoUser.id,
        objectType: "activity",
        objectId: demoActivity.id,
        action: AUDIT_ACTIONS.activityCreated,
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.users).toBe(1);
    expect(result.summary.activities).toBe(1);

    expect(await testDb.user.count({ where: { id: demoUser.id } })).toBe(0);
    expect(await testDb.activity.count({ where: { id: demoActivity.id } })).toBe(0);

    // Real users remain
    expect(await testDb.user.count()).toBe(2);

    // Purge operation itself leaves an audit log
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.demoDataPurged },
    });
    expect(log.userId).toBe(admin.id);
    expect(log.objectId).toBe("demo_data");
  });

  it("reports clearly when there is nothing to purge", async () => {
    const root = await createOrgUnit({ name: "Acta HQ" });
    const admin = await createUser(root.id, {
      email: "admin@company.test",
      isSystemAdmin: true,
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("nothing_to_purge");
  });
});

describe("demo data purge after score closing", () => {
  async function runPeriodClose() {
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
    return closeScorePeriod(testDb, new Date("2026-09-03T06:00:00.000Z"));
  }

  it("cleans up demo data with frozen period and facts", async () => {
    const { admin, demoUser } = await setupScenario();

    const closeResult = await runPeriodClose();
    expect(closeResult.written).toBeGreaterThan(0);
    const demoFacts = await testDb.userScorePeriodFact.count({
      where: { userId: demoUser.id },
    });
    expect(demoFacts).toBeGreaterThan(0);
    await testDb.scoreRecalculationRequest.create({
      data: {
        userId: demoUser.id,
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        sourceType: "TEST_DEMO_LATE_CHANGE",
        sourceId: "demo-late-change",
        requestedAt: new Date("2026-09-03T07:00:00.000Z"),
      },
    });
    expect(
      await testDb.scoreUserStateEvent.count({ where: { userId: demoUser.id } }),
    ).toBeGreaterThan(0);

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok, `Purge halted: ${JSON.stringify(result)}`).toBe(true);
    // Demo user period and facts removed; real users preserved
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: demoUser.id } }),
    ).toBe(0);
    expect(
      await testDb.userScorePeriod.count({ where: { userId: demoUser.id } }),
    ).toBe(0);
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { userId: demoUser.id },
      }),
    ).toBe(0);
    expect(
      await testDb.scoreUserStateEvent.count({ where: { userId: demoUser.id } }),
    ).toBe(0);
  });

  it("halts purge if real user score contribution is linked to demo activity", async () => {
    const { admin, realUser, demoActivity } = await setupScenario();

    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    await testDb.userScorePeriod.create({
      data: {
        userId: realUser.id,
        periodStart,
        regularity: 40,
        followUp: 30,
        total: 70,
        expectedDays: 22,
        writtenDays: 20,
        frozen: false,
      },
    });
    await testDb.userScorePeriodFact.create({
      data: {
        userId: realUser.id,
        periodStart,
        activityId: demoActivity.id,
        kind: "WRITTEN",
        happenedOn: periodStart,
      },
    });
    await testDb.userScorePeriod.update({
      where: {
        userId_periodStart_revisionNo: {
          userId: realUser.id,
          periodStart,
          revisionNo: 1,
        },
      },
      data: {
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });

    const result = await purgeDemoData(testDb, admin.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "blocked") {
      throw new Error(`Expected blocked result, got: ${JSON.stringify(result)}`);
    }
    expect(result.detail).toMatch(/score contribution/);
    // Nothing should be deleted
    expect(
      await testDb.userScorePeriodFact.count({ where: { userId: realUser.id } }),
    ).toBe(1);
    expect(await testDb.activity.count()).toBeGreaterThan(0);
  });
});
