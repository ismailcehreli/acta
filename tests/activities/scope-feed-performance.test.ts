import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listScopeActivities } from "@/server/activities/scope-feed";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §18.4 kabul ölçütü: 12 aylık veriyle ana ekran iki saniyenin altında
// açılmalı. Denetim, bu ölçütün hiç ölçülmediğini işaret etti (18.08.2026,
// FAZ 4 bulgu 11) — testler iki kayıtla çalışıyordu.
//
// Ölçüm mutlak bir başarım vaadi değildir: makineye göre değişir. Amaç,
// sorgunun kayıt sayısıyla birlikte kabul edilemez biçimde büyümediğini
// erkenden görmek. Sınır bilerek geniş tutuldu.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const KISI_SAYISI = 30;
const KISI_BASINA_GUN = 250;
const SURE_SINIRI_MS = 2_000;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function onIkiAylikSirket() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const director = await createUser(root.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });

  const departments = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      createOrgUnit({ name: `Departman ${i + 1}`, parentId: root.id }),
    ),
  );

  const authors = [];
  for (let i = 0; i < KISI_SAYISI; i += 1) {
    const unit = departments[i % departments.length];
    authors.push(
      await createUser(unit.id, {
        fullName: `Kullanıcı ${i + 1}`,
        // Her departmanın tek yöneticisi olur; kalanlar çalışan.
        isUnitManager: i < departments.length,
      }),
    );
  }

  for (const author of authors) {
    await testDb.activity.createMany({
      data: Array.from({ length: KISI_BASINA_GUN }, (_, gun) => ({
        authorId: author.id,
        authorOrgUnitId: author.orgUnitId,
        activityDate: new Date(NOW.getTime() - gun * 86_400_000),
        title: `Faaliyet ${gun + 1}`,
        description: "Gün içinde yapılan işin özeti.",
        approvalStatus: "APPROVED" as const,
        createdAt: new Date(NOW.getTime() - gun * 86_400_000),
        updatedAt: NOW,
      })),
    });
  }

  return { director, toplam: KISI_SAYISI * KISI_BASINA_GUN };
}

describe("12 aylık veriyle kapsam akışı", () => {
  it("tüm şirket görünümü sınırın altında açılır", async () => {
    const { director, toplam } = await onIkiAylikSirket();
    expect(await testDb.activity.count()).toBe(toplam);

    const basladi = performance.now();
    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 50 },
    );
    const gecen = performance.now() - basladi;

    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    // Ölçüm çıktıya yazılır: sınırın altında kalmak yetmez, ne kadar altında
    // olduğu da görünmeli.
    console.info(
      `[ölçüm] ${toplam} kayıtta ilk sayfa: ${gecen.toFixed(0)} ms`,
    );
    expect(gecen).toBeLessThan(SURE_SINIRI_MS);
  }, 120_000);

  it("son sayfa da sınırın altında açılır", async () => {
    const { director } = await onIkiAylikSirket();

    // Derin sayfaya imleçle gidilir; offset olsaydı derinlik arttıkça
    // yavaşlardı.
    let cursor = null;
    for (let i = 0; i < 20; i += 1) {
      const page = await listScopeActivities(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { period: "all" },
        NOW,
        { limit: 50, cursor },
      );
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    const basladi = performance.now();
    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 50, cursor },
    );
    const gecen = performance.now() - basladi;

    console.info(`[ölçüm] 1000. kayıt civarı sayfa: ${gecen.toFixed(0)} ms`);
    expect(page.items.length).toBeGreaterThan(0);
    expect(gecen).toBeLessThan(SURE_SINIRI_MS);
  }, 120_000);
});
