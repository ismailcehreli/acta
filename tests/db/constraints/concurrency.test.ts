import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../../helpers/test-db";

// Denetim (17.08.2026, bulgu 4 ve 10): kısıt tetikleyicileri mevcut
// durumu kilitsiz okuyordu, dolayısıyla eşzamanlı işlemler koruduğu değişmezi
// bozabiliyordu.
//
// Yarışı kurmak için iki ayrı bağlantı ve bir buluşma noktası gerekir: tek
// istemciden art arda gönderilen iki sorgu sıraya girer ve ikincisi birincinin
// sonucunu görür — yani hiçbir şeyi kanıtlamaz. Aşağıdaki testler iki işlemi
// açık tutup ikisini de aynı anda yazmaya zorlar.

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

/** İki işlemi de yazma anına kadar getirip aynı anda serbest bırakır. */
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

/** Ağaçta döngü var mı: her düğüm kökten erişilebilmeli. */
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

describe("eşzamanlı ağaç değişiklikleri", () => {
  it("karşılıklı taşıma denemesi ağaçta döngü bırakmaz", async () => {
    const root = await createOrgUnit();
    const a = await createOrgUnit({ parentId: root.id });
    const b = await createOrgUnit({ parentId: root.id });

    const barrier = createBarrier(2);

    const move = (client: PrismaClient, id: string, parentId: string) =>
      client.$transaction(
        async (tx) => {
          // İşlemi gerçekten aç, sonra diğerini bekle: iki yazma aynı anda
          // başlasın.
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

    // Kilit olmasaydı iki işlem de diğerinin eski hâlini görür ve ikisi de
    // geçerdi; sonuç kökten kopmuş bir döngü olurdu.
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(await everyUnitReachesRoot()).toBe(true);
  });
});

describe("eşzamanlı muhatap ekleme", () => {
  it("beş muhatap sınırı aşılamaz", async () => {
    const root = await createOrgUnit();
    const user = await createUser(root.id);
    const activity = await createActivity(user);

    // Dört muhatap eklenmiş durumda; iki işlem aynı anda beşinci ve altıncıyı
    // eklemeye çalışıyor. Kilitsiz sayımda ikisi de "4" görüp geçerdi.
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

// Denetim FAZ 2, bulgu 3 ve 4: pasifleştirme kontrolleri servis
// katmanında "önce oku, sonra yaz" düzenindeydi; kontrol ile yazım arasında
// eşzamanlı bir istek kuralı delebiliyordu. Kurallar veritabanına indirildi ve
// ilgili yollar aynı kilidi paylaşıyor.

describe("eşzamanlı birim pasifleştirme ve çocuk ekleme", () => {
  it("aktif çocuk pasif üstün altında kalamaz", async () => {
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
          data: { name: "Yeni Alt Birim", type: "Departman", parentId: parent.id },
        });
      },
      { timeout: 20_000 },
    );

    await Promise.allSettled([deactivate, addChild]);

    // Hangi sıra gerçekleşirse gerçekleşsin: pasif bir üstün altında aktif
    // çocuk bulunamaz.
    const bozukDurum = await testDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "OrgUnit" child
      JOIN "OrgUnit" parent ON child."parentId" = parent."id"
      WHERE child."isActive" AND NOT parent."isActive"
    `;
    expect(bozukDurum[0].count).toBe(0);
  });
});

describe("eşzamanlı kullanıcı pasifleştirme ve konuşma açma", () => {
  it("pasifleşen kullanıcıya açık konuşma bırakılamaz", async () => {
    const unit = await createOrgUnit();
    const asker = await createUser(unit.id);
    const responsible = await createUser(unit.id);
    const activity = await createActivity(responsible);
    const barrier = createBarrier(2);

    const deactivate = clientA.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'))`;
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

    // Pasif kullanıcının sorumlusu olduğu açık konuşma kalamaz (§9.3).
    const sahipsiz = await testDb.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Conversation" c
      JOIN "User" u ON u."id" = c."responsibleId"
      WHERE c."status" = 'OPEN' AND NOT u."isActive"
    `;
    expect(sahipsiz[0].count).toBe(0);
  });
});
