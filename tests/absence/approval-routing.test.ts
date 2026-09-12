import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideNoActivityPeriod,
  listTeamAbsences,
  markNoActivityPeriod,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import {
  resolveAbsenceApproversForUser,
} from "@/server/absence/approval-routing";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const executive = await createOrgUnit({
    name: "Executive Management",
    parentId: root.id,
  });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: executive.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: executive.id });

  const ceo = await createUser(executive.id, {
    fullName: "Chief Executive",
    isUnitManager: true,
  });
  const toolingManager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const planningManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const employee = await createUser(tooling.id, { fullName: "Tooling Employee" });

  return { ceo, toolingManager, planningManager, employee };
}

async function setupManagerLeave(
  ceoId: string,
  toolingManagerId: string,
  deputyId?: string,
) {
  const result = await markNoActivityPeriod(
    testDb,
    ceoId,
    {
      userId: toolingManagerId,
      startDate: "2026-08-20",
      endDate: "2026-08-27",
      ...(deputyId ? { deputyId } : {}),
    },
    NOW,
  );

  if (!result.ok) throw new Error(`Manager leave setup failed: ${result.message}`);
  return result;
}

describe("absence decision routing", () => {
  it("authorizes direct active manager and disallows upper manager", async () => {
    const { ceo, toolingManager, employee } = await setupCompany();

    const approvers = await resolveAbsenceApproversForUser(testDb, employee.id, NOW);
    expect(approvers).toEqual([{ id: toolingManager.id, route: "DIRECT_MANAGER" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      employee.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const upperDecision = await decideNoActivityPeriod(
      testDb,
      ceo.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(upperDecision.ok).toBe(false);
    if (!upperDecision.ok) expect(upperDecision.error).toBe("not_found");

    const directDecision = await decideNoActivityPeriod(
      testDb,
      toolingManager.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(directDecision.ok).toBe(true);
  });

  it("routes to active deputy when manager is on leave", async () => {
    const { ceo, toolingManager, planningManager, employee } = await setupCompany();
    await setupManagerLeave(ceo.id, toolingManager.id, planningManager.id);

    const approvers = await resolveAbsenceApproversForUser(testDb, employee.id, NOW);
    expect(approvers).toEqual([{ id: planningManager.id, route: "DEPUTY" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      employee.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const notification = await testDb.notificationQueue.findFirst({
      where: {
        userId: planningManager.id,
        eventType: NOTIFICATION_EVENTS.absenceRequestSubmitted,
      },
    });
    expect(notification).not.toBeNull();

    const decision = await decideNoActivityPeriod(
      testDb,
      planningManager.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(decision.ok).toBe(true);

    const list = await listTeamAbsences(
      testDb,
      planningManager.id,
      undefined,
      { userId: employee.id },
      { now: NOW },
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userName: "Tooling Employee",
      decidedByName: "Planning Manager",
      decisionRoute: "DEPUTY",
    });
  });

  it("escalates to first active upper manager when no deputy is assigned", async () => {
    const { ceo, toolingManager, planningManager, employee } = await setupCompany();
    await setupManagerLeave(ceo.id, toolingManager.id);

    const approvers = await resolveAbsenceApproversForUser(testDb, employee.id, NOW);
    expect(approvers).toEqual([{ id: ceo.id, route: "UPPER_MANAGER" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      employee.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const deputyDecision = await decideNoActivityPeriod(
      testDb,
      planningManager.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(deputyDecision.ok).toBe(false);

    const upperDecision = await decideNoActivityPeriod(
      testDb,
      ceo.id,
      request.id,
      "REJECTED",
      "Please re-check the selected dates.",
      NOW,
    );
    expect(upperDecision.ok).toBe(true);

    const list = await listTeamAbsences(
      testDb,
      ceo.id,
      undefined,
      { userId: employee.id },
      { now: NOW },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.decisionRoute).toBe("UPPER_MANAGER");
  });
});
