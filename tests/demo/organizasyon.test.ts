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
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    email: "yonetici@sirket.test",
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

    expect((await parent("Yönetim Kurulu")).parent?.name).toBe("Şirket");
    expect((await parent("Genel Müdürlük")).parent?.name).toBe("Yönetim Kurulu");
    expect(
      (await parent("Kalıphane")).parent?.name,
    ).toBe("Teknik İmalat");
    expect((await parent("Muhasebe")).parent?.name).toBe(
      "Mali İşler Koordinatörlüğü",
    );

    const board = await kullaniciId("yonetim.kurulu@ornek.test");
    const gm = await kullaniciId("emre.aslan@ornek.test");
    const logistics = await kullaniciId("ismail.cehreli@ornek.test");
    const purchasing = await kullaniciId("merve.satinalma@ornek.test");
    const purchasingEmployee = await kullaniciId("elif.satinalma@ornek.test");
    const accountingEmployee = await kullaniciId("berk.muhasebe@ornek.test");

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
      where: { user: { email: "yonetim.kurulu@ornek.test" } },
      select: { activityId: true },
    });
    expect(takdir).not.toBeNull();
  });
});
