import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { subordinateUserIds } from "@/server/authz/visibility";
import { countVisibleActivities } from "@/server/authz/activity-repository";
import { DEMO_UNIT_NAMES, installDemoData } from "@/server/demo/data";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupDemoCompany() {
  const root = await createOrgUnit({ name: "Acme Corp", type: "Root" });
  await createUser(root.id, {
    fullName: "System Administrator",
    email: "admin@company.test",
    isSystemAdmin: true,
  });

  const result = await installDemoData(testDb);
  if (!result.ok) throw new Error(`Demo data installation failed: ${result.error}`);
}

async function getUserIdByEmail(email: string): Promise<string> {
  const user = await testDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return user.id;
}

describe("demo organization chart", () => {
  it("installs tree, manager scopes, and sample appreciation", async () => {
    await setupDemoCompany();

    expect(
      await testDb.orgUnit.count({ where: { name: { in: [...DEMO_UNIT_NAMES] } } }),
    ).toBe(DEMO_UNIT_NAMES.length);

    const getParent = async (name: string) =>
      testDb.orgUnit.findFirstOrThrow({
        where: { name },
        select: { parent: { select: { name: true } } },
      });

    expect((await getParent("Board of Directors")).parent?.name).toBe("Acme Corp");
    expect((await getParent("Executive Management")).parent?.name).toBe("Board of Directors");
    expect(
      (await getParent("Tooling & Prototyping")).parent?.name,
    ).toBe("Engineering");
    expect((await getParent("Accounting")).parent?.name).toBe(
      "Finance & Accounting",
    );

    const board = await getUserIdByEmail("board@example.test");
    const gm = await getUserIdByEmail("alex.morgan@example.test");
    const logistics = await getUserIdByEmail("lucas.logistics@example.test");
    const purchasing = await getUserIdByEmail("emily.procurement@example.test");
    const purchasingEmployee = await getUserIdByEmail("rachel.procurement@example.test");
    const accountingEmployee = await getUserIdByEmail("daniel.accounting@example.test");

    const boardSubordinates = new Set(await subordinateUserIds(testDb, board));
    const gmSubordinates = new Set(await subordinateUserIds(testDb, gm));
    const logisticsSubordinates = new Set(
      await subordinateUserIds(testDb, logistics),
    );
    const purchasingSubordinates = new Set(
      await subordinateUserIds(testDb, purchasing),
    );

    expect(boardSubordinates.has(gm)).toBe(true);
    expect(gmSubordinates.has(logistics)).toBe(true);
    expect(gmSubordinates.has(purchasingEmployee)).toBe(true);
    expect(logisticsSubordinates.has(purchasingEmployee)).toBe(false);
    expect(purchasingSubordinates.has(purchasingEmployee)).toBe(true);
    expect(purchasingSubordinates.has(accountingEmployee)).toBe(false);

    const purchasingActivity = await testDb.activity.findFirstOrThrow({
      where: { authorId: purchasingEmployee, approvalStatus: "APPROVED" },
      select: { id: true },
    });
    const accountingActivity = await testDb.activity.findFirstOrThrow({
      where: { authorId: accountingEmployee, approvalStatus: "APPROVED" },
      select: { id: true },
    });

    expect(
      await countVisibleActivities(testDb, {
        id: gm,
        isSystemAdmin: false,
      }, { id: purchasingActivity.id }),
    ).toBe(1);
    expect(
      await countVisibleActivities(testDb, {
        id: logistics,
        isSystemAdmin: false,
      }, { id: purchasingActivity.id }),
    ).toBe(0);
    expect(
      await countVisibleActivities(testDb, {
        id: purchasing,
        isSystemAdmin: false,
      }, { id: accountingActivity.id }),
    ).toBe(0);

    const appreciation = await testDb.activityAppreciation.findFirst({
      where: { user: { email: "board@example.test" } },
      select: { activityId: true },
    });
    expect(appreciation).not.toBeNull();
  });
});
