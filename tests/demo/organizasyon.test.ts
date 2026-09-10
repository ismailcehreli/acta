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

async function kurulumYap() {
  const kok = await createOrgUnit({ name: "Acme Corp", type: "Root" });
  await createUser(kok.id, {
    fullName: "System Administrator",
    email: "admin@company.test",
    isSystemAdmin: true,
  });

  const sonuc = await installDemoData(testDb);
  if (!sonuc.ok) throw new Error(`örnek veri kurulamadı: ${sonuc.error}`);
}

async function kullaniciId(eposta: string): Promise<string> {
  const user = await testDb.user.findUniqueOrThrow({
    where: { email: eposta },
    select: { id: true },
  });
  return user.id;
}

describe("örnek organizasyon şeması", () => {
  it("ağacı, yönetici kapsamlarını ve takdir örneğini kurar", async () => {
    await kurulumYap();

    expect(
      await testDb.orgUnit.count({ where: { name: { in: [...DEMO_UNIT_NAMES] } } }),
    ).toBe(DEMO_UNIT_NAMES.length);

    const parent = async (name: string) =>
      testDb.orgUnit.findFirstOrThrow({
        where: { name },
        select: { parent: { select: { name: true } } },
      });

    expect((await parent("Board of Directors")).parent?.name).toBe("Acme Corp");
    expect((await parent("Executive Management")).parent?.name).toBe("Board of Directors");
    expect(
      (await parent("Tooling & Prototyping")).parent?.name,
    ).toBe("Engineering");
    expect((await parent("Accounting")).parent?.name).toBe(
      "Finance & Accounting",
    );

    const board = await kullaniciId("board@example.test");
    const gm = await kullaniciId("alex.morgan@example.test");
    const logistics = await kullaniciId("lucas.logistics@example.test");
    const purchasing = await kullaniciId("emily.procurement@example.test");
    const purchasingEmployee = await kullaniciId("rachel.procurement@example.test");
    const accountingEmployee = await kullaniciId("daniel.accounting@example.test");

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

    const takdir = await testDb.activityAppreciation.findFirst({
      where: { user: { email: "board@example.test" } },
      select: { activityId: true },
    });
    expect(takdir).not.toBeNull();
  });
});
