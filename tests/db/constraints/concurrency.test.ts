import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../../helpers/test-db";
import { ORG_TREE_LOCK_KEY } from "@/server/org/locks";

// Concurrency and race conditions (audit 17.08.2026, findings 4 and 10).
// Tests that database constraints and advisory locks prevent invariants from breaking under concurrency.

const clientA = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });
const clientB = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([
    testDb.$disconnect(),
    clientA.$disconnect(),
    clientB.$disconnect(),
  ]);
});

/** Brings both transactions to the write moment and releases them concurrently. */
function createBarrier(participants: number) {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async function waitForOthers(): Promise<void> {
    arrived += 1;
    if (arrived >= participants) release();
    await gate;
  };
}

/** Verifies no cycles in tree: every unit must reach root. */
async function everyUnitReachesRoot(): Promise<boolean> {
  const [row] = await testDb.$queryRaw<{ reachable: bigint; total: bigint }[]>`
    WITH RECURSIVE reachable(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "parentId" IS NULL
      UNION
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN reachable ON child."parentId" = reachable.id
    )
    SELECT
      (SELECT COUNT(*) FROM reachable) AS reachable,
      (SELECT COUNT(*) FROM "OrgUnit") AS total
  `;

  return row.reachable === row.total;
}

describe("concurrent tree modifications", () => {
  it("concurrent reciprocal moves do not leave cycle in tree", async () => {
    const root = await createOrgUnit();
    const a = await createOrgUnit({ parentId: root.id });
    const b = await createOrgUnit({ parentId: root.id });

    const barrier = createBarrier(2);

    const move = (client: PrismaClient, id: string, parentId: string) =>
      client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          await barrier();
          await tx.orgUnit.update({ where: { id }, data: { parentId } });
        },
        { timeout: 20_000 },
      );

    const results = await Promise.allSettled([
      move(clientA, a.id, b.id),
      move(clientB, b.id, a.id),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(await everyUnitReachesRoot()).toBe(true);
  });
});

describe("concurrent target department additions", () => {
  it("does not exceed limit of five target departments", async () => {
    const root = await createOrgUnit();
    const user = await createUser(root.id);
    const activity = await createActivity(user);

    for (let i = 0; i < 4; i += 1) {
      const dept = await createOrgUnit({ parentId: root.id });
      await testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: dept.id },
      });
    }

    const fifth = await createOrgUnit({ parentId: root.id });
    const sixth = await createOrgUnit({ parentId: root.id });
    const barrier = createBarrier(2);

    const addTarget = (client: PrismaClient, orgUnitId: string) =>
      client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          await barrier();
          await tx.activityTargetDept.create({
            data: { activityId: activity.id, orgUnitId },
          });
        },
        { timeout: 20_000 },
      );

    await Promise.allSettled([
      addTarget(clientA, fifth.id),
      addTarget(clientB, sixth.id),
    ]);

    const count = await testDb.activityTargetDept.count({
      where: { activityId: activity.id },
    });
    expect(count).toBe(5);
  });
});

describe("concurrent unit deactivation and child addition", () => {
  it("active child cannot remain under inactive parent", async () => {
    const root = await createOrgUnit();
    const parent = await createOrgUnit({ parentId: root.id });
    const barrier = createBarrier(2);

    const deactivate = clientA.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        await barrier();
        await tx.orgUnit.update({
          where: { id: parent.id },
          data: { isActive: false },
        });
      },
      { timeout: 20_000 },
    );

    const addChild = clientB.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        await barrier();
        await tx.orgUnit.create({
          data: { name: "New Subunit", type: "Department", parentId: parent.id },
        });
      },
      { timeout: 20_000 },
    );

    await Promise.allSettled([deactivate, addChild]);

    const invalidState = await testDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "OrgUnit" child
      JOIN "OrgUnit" parent ON child."parentId" = parent."id"
      WHERE child."isActive" AND NOT parent."isActive"
    `;
    expect(invalidState[0].count).toBe(0);
  });
});

describe("concurrent user deactivation and conversation opening", () => {
  it("open conversation cannot be left assigned to deactivated user", async () => {
    const unit = await createOrgUnit();
    const asker = await createUser(unit.id);
    const responsible = await createUser(unit.id);
    const activity = await createActivity(responsible);
    const barrier = createBarrier(2);

    const deactivate = clientA.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_TREE_LOCK_KEY}))`;
        await barrier();
        await tx.user.update({
          where: { id: responsible.id },
          data: { isActive: false },
        });
      },
      { timeout: 20_000 },
    );

    const openConversation = clientB.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        await barrier();
        await tx.conversation.create({
          data: {
            activityId: activity.id,
            askerId: asker.id,
            responsibleId: responsible.id,
          },
        });
      },
      { timeout: 20_000 },
    );

    await Promise.allSettled([deactivate, openConversation]);

    const orphaned = await testDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Conversation" c
      JOIN "User" u ON u."id" = c."responsibleId"
      WHERE c."status" = 'OPEN' AND NOT u."isActive"
    `;
    expect(orphaned[0].count).toBe(0);
  });
});
