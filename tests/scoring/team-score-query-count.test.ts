import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readTeamScores, readScoreTrends } from "@/server/scoring/read";
import { SETTING_KEYS } from "@/server/settings/registry";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Query budget and scaling performance for team score computations.
// Verifies that queries scale sub-linearly with team size rather than O(N) queries per user.

const TEAM_SIZE = 40;
const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Custom client logging SQL query count */
function queryCountingClient() {
  const client = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
    log: [{ emit: "event", level: "query" }],
  });

  let counter = 0;
  (client as unknown as {
    $on: (event: "query", listener: () => void) => void;
  }).$on("query", () => {
    counter += 1;
  });

  return {
    client,
    reset: () => {
      counter = 0;
    },
    getCount: () => counter,
  };
}

/** Client tracking number of rows fetched by model */
function rowCountingClient() {
  const counters: Record<string, number> = {};

  const client = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  }).$extends({
    query: {
      async $allOperations({ model, args, query }) {
        const result = await query(args);
        if (Array.isArray(result)) {
          const key = model ?? "raw";
          counters[key] = (counters[key] ?? 0) + result.length;
        }
        return result;
      },
    },
  });

  return {
    client,
    reset: () => {
      for (const key of Object.keys(counters)) delete counters[key];
    },
    getRows: () => ({ ...counters }),
  };
}

async function setupTeam(personCount: number) {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const manager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });

  for (let i = 0; i < personCount; i += 1) {
    const user = await createUser(unit.id, { fullName: `Employee ${i + 1}` });
    for (const day of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
      await createActivity(user, { activityDate: new Date(`${day}T00:00:00.000Z`) });
    }
    await testDb.userScorePeriod.create({
      data: {
        userId: user.id,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        regularity: 70,
        followUp: 100,
        total: 78,
        expectedDays: 22,
        writtenDays: 15,
        frozen: true,
        profile: "employee",
        weightRegularity: 40,
        weightAcceptance: 30,
        weightApproval: 0,
        weightFollowUp: 30,
        formulaVersion: 1,
      },
    });
  }

  await testDb.systemSetting.create({
    data: {
      key: SETTING_KEYS.scoringEnabled,
      value: "true",
      description: "Score system",
    },
  });

  return { manager };
}

describe("trend reading does not scale linearly with historical period depth", () => {
  async function setupUserWithPeriods(periodCount: number) {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const manager = await createUser(root.id, {
      fullName: "General Manager",
      isUnitManager: true,
    });
    const user = await createUser(unit.id, { fullName: "Employee" });

    for (let i = 0; i < periodCount; i += 1) {
      const periodStart = new Date(Date.UTC(2021, i, 1));
      await testDb.userScorePeriod.create({
        data: {
          userId: user.id,
          periodStart,
          regularity: 40,
          followUp: 30,
          total: 70,
          expectedDays: 22,
          writtenDays: 20,
          frozen: false,
        },
      });

      const activity = await createActivity(user, { activityDate: periodStart });
      await testDb.userScorePeriodFact.createMany({
        data: Array.from({ length: 20 }, () => ({
          userId: user.id,
          periodStart,
          activityId: activity.id,
          kind: "WRITTEN" as const,
          happenedOn: periodStart,
        })),
      });

      await testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: user.id,
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
    }

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.scoringEnabled,
        value: "true",
        description: "Score system",
      },
    });

    return { manager, user };
  }

  async function setupUserWithPeriodsHelper(
    unitId: string,
    name: string,
    startMonth: number,
    periodCount: number,
  ) {
    const user = await createUser(unitId, { fullName: name });

    for (let i = 0; i < periodCount; i += 1) {
      const periodStart = new Date(Date.UTC(2021, startMonth + i, 1));
      await testDb.userScorePeriod.create({
        data: {
          userId: user.id,
          periodStart,
          regularity: 40,
          followUp: 30,
          total: 70,
          expectedDays: 22,
          writtenDays: 20,
          frozen: false,
        },
      });

      const activity = await createActivity(user, { activityDate: periodStart });
      await testDb.userScorePeriodFact.createMany({
        data: Array.from({ length: 10 }, () => ({
          userId: user.id,
          periodStart,
          activityId: activity.id,
          kind: "WRITTEN" as const,
          happenedOn: periodStart,
        })),
      });

      await testDb.userScorePeriod.update({
        where: {
          userId_periodStart_revisionNo: {
            userId: user.id,
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
    }

    return user;
  }

  it("reads only bounded number of periods across 60-period history", async () => {
    const counterClient = queryCountingClient();

    try {
      const measure = async (periodCount: number) => {
        await resetDatabase();
        const { manager, user } = await setupUserWithPeriods(periodCount);

        const trends = await readScoreTrends(
          counterClient.client,
          { id: manager.id, isSystemAdmin: false },
          [user.id],
        );
        return trends.get(user.id)?.periods.length ?? 0;
      };

      expect(await measure(1)).toBe(1);
      expect(await measure(60)).toBe(6);
    } finally {
      await counterClient.client.$disconnect();
    }
  });

  it("fetches only selected user-period pairs in asymmetric histories", async () => {
    const rowCounter = rowCountingClient();

    try {
      await resetDatabase();
      const root = await createOrgUnit({ name: "Company Root", type: "Root" });
      const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
      const manager = await createUser(root.id, {
        fullName: "General Manager",
        isUnitManager: true,
      });

      const longHistoryUser = await setupUserWithPeriodsHelper(unit.id, "Long History", 0, 12);
      const shortHistoryUser = await setupUserWithPeriodsHelper(unit.id, "Short History", 0, 6);

      await testDb.systemSetting.create({
        data: {
          key: SETTING_KEYS.scoringEnabled,
          value: "true",
          description: "Score system",
        },
      });

      rowCounter.reset();
      await readScoreTrends(
        rowCounter.client as unknown as Parameters<typeof readScoreTrends>[0],
        { id: manager.id, isSystemAdmin: false },
        [longHistoryUser.id, shortHistoryUser.id],
      );
      const fetched = rowCounter.getRows();

      expect(fetched.UserScorePeriodFact).toBe(2 * 6 * 10);
    } finally {
      await rowCounter.client.$disconnect();
    }
  });

  it("number of fetched rows does not grow with total history depth", async () => {
    const rowCounter = rowCountingClient();

    try {
      const measure = async (periodCount: number) => {
        await resetDatabase();
        const { manager, user } = await setupUserWithPeriods(periodCount);
        rowCounter.reset();

        await readScoreTrends(
          rowCounter.client as unknown as Parameters<typeof readScoreTrends>[0],
          { id: manager.id, isSystemAdmin: false },
          [user.id],
        );

        return rowCounter.getRows();
      };

      const smallHistory = await measure(1);
      const largeHistory = await measure(60);

      expect((largeHistory.raw ?? 0) - (smallHistory.raw ?? 0)).toBeLessThanOrEqual(5);
      expect(largeHistory.UserScorePeriodFact).toBeLessThanOrEqual(6 * 20);
    } finally {
      await rowCounter.client.$disconnect();
    }
  });
});

describe("team score query budget", () => {
  it("query count does not double when team size doubles", async () => {
    const queryCounter = queryCountingClient();

    try {
      const measure = async (personCount: number) => {
        await resetDatabase();
        const { manager } = await setupTeam(personCount);
        const viewer = { id: manager.id, isSystemAdmin: false };

        await queryCounter.client.user.count();
        queryCounter.reset();

        const scores = await readTeamScores(queryCounter.client, viewer, NOW);
        await readScoreTrends(
          queryCounter.client,
          viewer,
          scores.map((s) => s.userId),
        );

        return { people: scores.length, queries: queryCounter.getCount() };
      };

      const halfTeam = await measure(TEAM_SIZE / 2);
      const fullTeam = await measure(TEAM_SIZE);

      expect(halfTeam.people).toBe(TEAM_SIZE / 2);
      expect(fullTeam.people).toBe(TEAM_SIZE);

      expect(fullTeam.queries).toBeLessThan(halfTeam.queries * 1.5);
    } finally {
      await queryCounter.client.$disconnect();
    }
  });
});
