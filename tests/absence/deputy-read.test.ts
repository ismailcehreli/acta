import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { listDeputyPeriods } from "@/server/absence/deputy-read";
import { AUDIT_ACTIONS } from "@/server/audit/log";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Deputy summary period boundaries are calculated based on company day (Europe/Istanbul timezone).
// The period's startDate/endDate are dates stored at UTC midnight. Decision timestamps are exact times.

const IN_LEAVE = new Date("2026-08-21T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** One-day deputyship: August 21, 2026. */
async function setupSingleDayDeputyship() {
  const root = await createOrgUnit({ name: "Acta HQ" });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const ceo = await createUser(root.id, {
    email: "ceo@example.test",
    isUnitManager: true,
  });
  const toolingManager = await createUser(tooling.id, {
    email: "tooling.manager@example.test",
    isUnitManager: true,
  });
  const deputy = await createUser(planning.id, {
    email: "deputy@example.test",
    isUnitManager: true,
  });

  const period = await markNoActivityPeriod(
    testDb,
    ceo.id,
    {
      userId: toolingManager.id,
      startDate: "2026-08-21",
      endDate: "2026-08-21",
      deputyId: deputy.id,
    },
    IN_LEAVE,
  );
  if (!period.ok) throw new Error("Deputyship setup failed");

  return { toolingManager, deputy };
}

/** Record audit trail for decision made by deputy on behalf of principal. */
async function recordDecisionAudit(deputyId: string, principalId: string, createdAt: Date) {
  await testDb.auditLog.create({
    data: {
      userId: deputyId,
      actualUserId: principalId,
      objectType: "activity",
      objectId: "00000000-0000-4000-8000-000000000001",
      action: AUDIT_ACTIONS.activityApproved,
      createdAt,
    },
  });
}

describe("deputyship period boundaries based on Istanbul company day", () => {
  it("counts decision made just after midnight on the first day of the period", async () => {
    const { toolingManager, deputy } = await setupSingleDayDeputyship();

    // Istanbul August 21 00:30 = UTC August 20 21:30
    await recordDecisionAudit(deputy.id, toolingManager.id, new Date("2026-08-20T21:30:00.000Z"));

    const periods = await listDeputyPeriods(testDb, deputy.id, IN_LEAVE);

    expect(periods).toHaveLength(1);
    expect(periods[0]?.decisionCount).toBe(1);
  });

  it("does not count decision made in early hours after the period ends", async () => {
    const { toolingManager, deputy } = await setupSingleDayDeputyship();

    // Istanbul August 22 02:00 = UTC August 21 23:00. Period ended on August 21
    await recordDecisionAudit(deputy.id, toolingManager.id, new Date("2026-08-21T23:00:00.000Z"));

    const periods = await listDeputyPeriods(testDb, deputy.id, IN_LEAVE);

    expect(periods[0]?.decisionCount).toBe(0);
  });

  it("counts decision made during working hours within the period", async () => {
    const { toolingManager, deputy } = await setupSingleDayDeputyship();

    await recordDecisionAudit(deputy.id, toolingManager.id, new Date("2026-08-21T11:00:00.000Z"));

    const periods = await listDeputyPeriods(testDb, deputy.id, IN_LEAVE);

    expect(periods[0]?.decisionCount).toBe(1);
  });

  it("does not count decision made in late hours of the day before the period", async () => {
    const { toolingManager, deputy } = await setupSingleDayDeputyship();

    // Istanbul August 20 23:00 = UTC August 20 20:00
    await recordDecisionAudit(deputy.id, toolingManager.id, new Date("2026-08-20T20:00:00.000Z"));

    const periods = await listDeputyPeriods(testDb, deputy.id, IN_LEAVE);

    expect(periods[0]?.decisionCount).toBe(0);
  });
});
