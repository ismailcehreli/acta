import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countTeamAbsences, listTeamAbsences } from "@/server/absence/service";
import {
  countDeputyPeriods,
  listDeputyPeriods,
} from "@/server/absence/deputy-read";
import { subordinateUserIds } from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Team absence and deputyship list filters.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const tooling = await createOrgUnit({ name: "Tooling", parentId: root.id });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const employee1 = await createUser(tooling.id, { fullName: "Worker One" });
  const employee2 = await createUser(tooling.id, { fullName: "Worker Two" });

  return { root, manager, employee1, employee2 };
}

const parseDay = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function createPeriod(
  userId: string,
  markedById: string,
  start: string,
  end: string,
  opts: { deputyId?: string; cancelled?: boolean } = {},
) {
  return testDb.noActivityPeriod.create({
    data: {
      userId,
      markedById,
      startDate: parseDay(start),
      endDate: parseDay(end),
      ...(opts.deputyId ? { deputyId: opts.deputyId } : {}),
      ...(opts.cancelled
        ? {
            cancelledAt: NOW,
            cancelledById: markedById,
            cancellationReason: "Entered incorrectly",
          }
        : {}),
    },
  });
}

describe("team absence list: user filter", () => {
  it("returns only periods for the selected user", async () => {
    const { manager, employee1, employee2 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12");
    await createPeriod(employee2.id, manager.id, "2026-08-11", "2026-08-13");

    const subordinates = await subordinateUserIds(testDb, manager.id);
    const result = await listTeamAbsences(testDb, manager.id, subordinates, {
      userId: employee1.id,
    });

    expect(result.map((d) => d.userName)).toEqual(["Worker One"]);
  });
});

describe("team absence list: status filter", () => {
  it("distinguishes active and cancelled periods", async () => {
    const { manager, employee1 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12");
    await createPeriod(employee1.id, manager.id, "2026-08-14", "2026-08-15", { cancelled: true });

    const subordinates = await subordinateUserIds(testDb, manager.id);

    const activePeriods = await listTeamAbsences(testDb, manager.id, subordinates, {
      status: "active",
    });
    const cancelledPeriods = await listTeamAbsences(testDb, manager.id, subordinates, {
      status: "cancelled",
    });

    expect(activePeriods).toHaveLength(1);
    expect(activePeriods[0]?.cancelledReason).toBeNull();
    expect(cancelledPeriods).toHaveLength(1);
    expect(cancelledPeriods[0]?.cancelledReason).toBe("Entered incorrectly");
  });
});

describe("team absence list: pagination", () => {
  it("returns requested limit and total count matches filters", async () => {
    const { manager, employee1 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-11");
    await createPeriod(employee1.id, manager.id, "2026-08-12", "2026-08-13");
    await createPeriod(employee1.id, manager.id, "2026-08-14", "2026-08-15");

    const subordinates = await subordinateUserIds(testDb, manager.id);

    expect(await listTeamAbsences(testDb, manager.id, subordinates, {}, { limit: 2 })).toHaveLength(2);
    expect(await countTeamAbsences(testDb, manager.id, subordinates, {})).toBe(3);
  });
});

describe("team absence list scope enforcement", () => {
  it("never returns periods of non-subordinates under any filter", async () => {
    const { root, manager, employee1 } = await setupCompany();
    const planning = await createOrgUnit({ name: "Planning", parentId: root.id });
    const outsider = await createUser(planning.id, { fullName: "Outsider" });
    await createPeriod(outsider.id, outsider.id, "2026-08-10", "2026-08-12");
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12");

    const subordinates = await subordinateUserIds(testDb, manager.id);
    const result = await listTeamAbsences(testDb, manager.id, subordinates, {
      userId: outsider.id,
    });

    expect(result).toHaveLength(0);
  });
});

describe("deputyship list", () => {
  it("filters by principal user", async () => {
    const { manager, employee1, employee2 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12", {
      deputyId: manager.id,
    });
    await createPeriod(employee2.id, manager.id, "2026-08-10", "2026-08-12", {
      deputyId: manager.id,
    });

    const result = await listDeputyPeriods(testDb, manager.id, NOW, {
      personId: employee1.id,
    });

    expect(result.map((d) => d.personName)).toEqual(["Worker One"]);
  });

  it("paginates and reports filtered total", async () => {
    const { manager, employee1, employee2 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12", {
      deputyId: manager.id,
    });
    await createPeriod(employee2.id, manager.id, "2026-08-14", "2026-08-16", {
      deputyId: manager.id,
    });

    expect(
      await listDeputyPeriods(testDb, manager.id, NOW, {}, { limit: 1 }),
    ).toHaveLength(1);
    expect(await countDeputyPeriods(testDb, manager.id, {})).toBe(2);
  });

  it("never returns someone else's deputyship", async () => {
    const { manager, employee1, employee2 } = await setupCompany();
    await createPeriod(employee1.id, manager.id, "2026-08-10", "2026-08-12", {
      deputyId: manager.id,
    });

    const result = await listDeputyPeriods(testDb, employee2.id, NOW, {
      personId: employee1.id,
    });

    expect(result).toHaveLength(0);
  });
});
