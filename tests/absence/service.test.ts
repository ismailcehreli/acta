import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideNoActivityPeriod,
  isNoActivityDay,
  listTeamAbsences,
  markNoActivityPeriod,
  markOwnNoActivityPeriod,
  cancelNoActivityPeriod,
} from "@/server/absence/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Absence / "No Activity Expected" period service tests.
// Authorization stems from organizational hierarchy: only direct managers (or delegates) can mark absences.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const executive = await createOrgUnit({ name: "Executive Management", parentId: root.id });
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
  const toolingEmployee = await createUser(tooling.id, {
    fullName: "Tooling Employee",
  });
  const planningManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const planningEmployee = await createUser(planning.id, {
    fullName: "Planning Employee",
  });

  return { ceo, toolingManager, toolingEmployee, planningManager, planningEmployee };
}

describe("absence marking authorization", () => {
  it("manager can mark absence for direct subordinate", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("peer manager cannot mark absence for another department's employee", async () => {
    const { planningManager, toolingEmployee } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      planningManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_subordinate");
    expect(await testDb.noActivityPeriod.count()).toBe(0);
  });

  it("user with no subordinates cannot mark absence", async () => {
    const { toolingEmployee, toolingManager } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      toolingEmployee.id,
      { userId: toolingManager.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_subordinate");
  });

  it("upper tier cannot mark absence for sub-department employee directly", async () => {
    const { ceo, toolingEmployee } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      ceo.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_subordinate");
  });

  it("deputy cannot be assigned for regular non-manager employee", async () => {
    const { toolingManager, toolingEmployee, planningManager } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      {
        userId: toolingEmployee.id,
        startDate: "2026-08-18",
        endDate: "2026-08-22",
        deputyId: planningManager.id,
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("absent_not_manager");
  });
});

describe("date range validation", () => {
  it("rejects end date earlier than start date", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();

    const result = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-22", endDate: "2026-08-18" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_range");
  });

  it("rejects overlapping absence range", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    const result = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-20", endDate: "2026-08-25" },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("overlaps");
    expect(await testDb.noActivityPeriod.count()).toBe(1);
  });

  it("accepts adjacent non-overlapping ranges", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    const result = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-23", endDate: "2026-08-25" },
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});

describe("listing and cancellation", () => {
  it("manager only sees absences for their own team", async () => {
    const { toolingManager, toolingEmployee, planningManager, ceo } = await setupCompany();
    await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(await listTeamAbsences(testDb, toolingManager.id)).toHaveLength(1);
    expect(await listTeamAbsences(testDb, planningManager.id)).toHaveLength(0);

    const upperList = await listTeamAbsences(testDb, ceo.id);
    expect(upperList).toHaveLength(1);
    expect(upperList[0]?.canDecide).toBe(false);
    expect(upperList[0]?.canCancel).toBe(false);
  });

  it("manager of another department cannot decide on pending absence request", async () => {
    const { toolingManager, toolingEmployee, planningManager } = await setupCompany();
    const request = await markOwnNoActivityPeriod(
      testDb,
      toolingEmployee.id,
      { startDate: "2026-09-01", endDate: "2026-09-05" },
      NOW,
    );
    if (!request.ok) throw new Error("Request creation failed");

    const foreignDecision = await decideNoActivityPeriod(
      testDb,
      planningManager.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(foreignDecision.ok).toBe(false);
    if (!foreignDecision.ok) expect(foreignDecision.error).toBe("not_found");

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

  it("cannot cancel absence of another team's member", async () => {
    const { toolingManager, toolingEmployee, planningManager } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    const foreignCancel = await cancelNoActivityPeriod(
      testDb,
      planningManager.id,
      created.id,
      "Incorrect entry",
      NOW,
    );
    expect(foreignCancel.ok).toBe(false);
    if (!foreignCancel.ok) expect(foreignCancel.error).toBe("not_found");

    const ownCancel = await cancelNoActivityPeriod(
      testDb,
      toolingManager.id,
      created.id,
      "Incorrect entry",
      NOW,
    );
    expect(ownCancel.ok).toBe(true);
  });

  it("cancellation does NOT delete: record remains with reason", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "Entered in error", NOW);

    const record = await testDb.noActivityPeriod.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(record.cancelledAt).not.toBeNull();
    expect(record.cancelledById).toBe(toolingManager.id);
    expect(record.cancellationReason).toBe("Entered in error");
  });

  it("cannot cancel without providing a reason", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    const result = await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "   ", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("reason_required");
  });

  it("cannot cancel the same record twice", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    expect((await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "first", NOW)).ok).toBe(true);
    const second = await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "second", NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("not_found");
  });

  it("cancelled period does not pause activity reminders", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");

    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-20")).toBe(true);
    await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "In error", NOW);
    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-20")).toBe(false);
  });

  it("allows entering a new period over cancelled period dates", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    const created = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    if (!created.ok) throw new Error("Creation failed");
    await cancelNoActivityPeriod(testDb, toolingManager.id, created.id, "Wrong dates", NOW);

    const replacement = await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );
    expect(replacement.ok).toBe(true);
  });
});

describe("isNoActivityDay query", () => {
  it("counts days within range as marked", async () => {
    const { toolingManager, toolingEmployee } = await setupCompany();
    await markNoActivityPeriod(
      testDb,
      toolingManager.id,
      { userId: toolingEmployee.id, startDate: "2026-08-18", endDate: "2026-08-22" },
      NOW,
    );

    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-18")).toBe(true);
    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-20")).toBe(true);
    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-22")).toBe(true);

    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-17")).toBe(false);
    expect(await isNoActivityDay(testDb, toolingEmployee.id, "2026-08-23")).toBe(false);
    expect(await isNoActivityDay(testDb, toolingManager.id, "2026-08-20")).toBe(false);
  });
});
