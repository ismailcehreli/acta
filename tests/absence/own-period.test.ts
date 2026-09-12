import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelNoActivityPeriod,
  decideNoActivityPeriod,
  isNoActivityDay,
  listOwnAbsences,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import { resolveAbsenceApproversForUser } from "@/server/absence/approval-routing";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// User's own absence request flow.
// When an employee submits their own absence, it routes to their manager for approval.
// A manager submitting their own absence period is automatically approved.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee1 = await createUser(tooling.id, { fullName: "Worker One" });
  const employee2 = await createUser(tooling.id, { fullName: "Worker Two" });

  return { manager, employee1, employee2, planning };
}

describe("user submits own absence", () => {
  it("period is saved with pending status", async () => {
    const { employee1 } = await setupCompany();

    const result = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05", note: "Annual leave" },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("PENDING");
    const record = await testDb.noActivityPeriod.findFirst({
      where: { userId: employee1.id },
    });
    expect(record?.markedById).toBe(employee1.id);
    expect(record?.status).toBe("PENDING");
    expect(await isNoActivityDay(testDb, employee1.id, "2026-09-03")).toBe(false);
  });

  it("sends notification to manager upon submission", async () => {
    const { manager, employee1 } = await setupCompany();

    await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    const notifications = await testDb.notificationQueue.findMany({
      where: { userId: manager.id },
    });
    expect(notifications.map((n) => n.eventType)).toContain(
      NOTIFICATION_EVENTS.absenceRequestSubmitted,
    );
  });

  it("manager's own absence is immediately approved", async () => {
    const { manager } = await setupCompany();

    const result = await markOwnNoActivityPeriod(
      testDb,
      manager.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("APPROVED");
    expect(await isNoActivityDay(testDb, manager.id, "2026-09-03")).toBe(true);
  });

  it("manager can select deputy during own absence", async () => {
    const { manager, employee1, planning } = await setupCompany();
    const deputy = await createUser(planning.id, {
      fullName: "Planning Manager",
      isUnitManager: true,
    });

    const result = await markOwnNoActivityPeriod(
      testDb,
      manager.id,
      {
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        deputyId: deputy.id,
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(record.status).toBe("APPROVED");
    expect(record.deputyId).toBe(deputy.id);

    const approvers = await resolveAbsenceApproversForUser(
      testDb,
      employee1.id,
      new Date("2026-09-03T09:00:00.000Z"),
    );
    expect(approvers).toEqual([{ id: deputy.id, route: "DEPUTY" }]);
  });

  it("manager approval activates the absence days", async () => {
    const { manager, employee1 } = await setupCompany();
    const request = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const decision = await decideNoActivityPeriod(
      testDb,
      manager.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.status).toBe("APPROVED");
    expect(await isNoActivityDay(testDb, employee1.id, "2026-09-03")).toBe(true);
    const notifications = await testDb.notificationQueue.findMany({
      where: { userId: employee1.id },
    });
    expect(notifications.map((n) => n.eventType)).toContain(
      NOTIFICATION_EVENTS.absenceRequestApproved,
    );
  });

  it("manager cannot reject request without a reason note", async () => {
    const { manager, employee1 } = await setupCompany();
    const request = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const decision = await decideNoActivityPeriod(
      testDb,
      manager.id,
      request.id,
      "REJECTED",
      "   ",
      NOW,
    );

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error).toBe("reason_required");
  });

  it("manager rejection with reason keeps absence days inactive", async () => {
    const { manager, employee1 } = await setupCompany();
    const request = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const decision = await decideNoActivityPeriod(
      testDb,
      manager.id,
      request.id,
      "REJECTED",
      "Please adjust dates to avoid overlap.",
      NOW,
    );

    expect(decision.ok).toBe(true);
    expect(await isNoActivityDay(testDb, employee1.id, "2026-09-03")).toBe(false);
    const record = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(record.status).toBe("REJECTED");
    expect(record.decisionReason).toBe("Please adjust dates to avoid overlap.");
  });

  it("user can view their own absence list", async () => {
    const { employee1, employee2 } = await setupCompany();
    await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    await markOwnNoActivityPeriod(
      testDb,
      employee2.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    const list = await listOwnAbsences(testDb, employee1.id);

    expect(list).toHaveLength(1);
    expect(list[0]?.userId).toBe(employee1.id);
  });
});

describe("maximum period limit", () => {
  it("rejects period exceeding configured maximum days", async () => {
    const { employee1 } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "30" });

    const result = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-10-15" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("too_long_for_self");
  });

  it("accepts period within configured maximum days", async () => {
    const { employee1 } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "30" });

    const result = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-20" },
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("manager entry is not restricted by self-absence limit", async () => {
    const { manager, employee1 } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.selfAbsenceMaxDays]: "10" });

    const { markNoActivityPeriod } = await import("@/server/absence/service");
    const result = await markNoActivityPeriod(
      testDb,
      manager.id,
      { userId: employee1.id, startDate: "2026-09-01", endDate: "2026-10-15" },
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});

describe("cancellation of own period", () => {
  it("user can cancel their own period with a reason", async () => {
    const { employee1 } = await setupCompany();
    const created = await markOwnNoActivityPeriod(
      testDb,
      employee1.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    const result = await cancelNoActivityPeriod(
      testDb,
      employee1.id,
      created.id,
      "Incorrect date entered",
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});

describe("isolation from other users' periods", () => {
  it("own list never includes another user's absence", async () => {
    const { employee1, employee2 } = await setupCompany();
    await markOwnNoActivityPeriod(
      testDb,
      employee2.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );

    expect(await listOwnAbsences(testDb, employee1.id)).toHaveLength(0);
  });

  it("user cannot cancel another user's period", async () => {
    const { employee1, employee2 } = await setupCompany();
    const created = await markOwnNoActivityPeriod(
      testDb,
      employee2.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    const result = await cancelNoActivityPeriod(
      testDb,
      employee1.id,
      created.id,
      "Not my record",
      NOW,
    );

    expect(result.ok).toBe(false);
  });
});
