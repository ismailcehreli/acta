import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  listScopeActivities,
  type FeedCursor,
} from "@/server/activities/scope-feed";
import { decodeCursor, encodeCursor } from "@/server/activities/feed-cursor";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Denetim (18.08.2026, FAZ 4 bulgu 11): "Tümü" akışı `take: 100` ile
// sessizce kesiliyordu; 101. kayıttan sonrası hiçbir yoldan erişilemiyordu.
// Adı "Tümü" olan bir görünümün kayıtların çoğunu saklaması, eksik olduğunu
// söylememesinden daha kötü.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function companyWith(activityCount: number) {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const unit = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const director = await createUser(root.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const author = await createUser(unit.id, {
    fullName: "Müdür",
    isUnitManager: true,
  });

  // Aynı güne düşen kayıtlar bilerek üretilir: sıralamanın ikinci ve üçüncü
  // alanı (createdAt, id) olmasaydı imleç sayfa sınırında satır atlardı.
  await testDb.activity.createMany({
    data: Array.from({ length: activityCount }, (_, i) => ({
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date(
        Date.UTC(2026, 7, 17 - Math.floor(i / 10)),
      ),
      title: `Faaliyet ${i + 1}`,
      description: "Açıklama",
      approvalStatus: "APPROVED" as const,
      createdAt: new Date(NOW.getTime() - i * 1_000),
      updatedAt: NOW,
    })),
  });

  return { director, author };
}

async function tumSayfalar(viewerId: string, limit: number) {
  const ids: string[] = [];
  let cursor: FeedCursor | null = null;
  let sayfa = 0;

  do {
    const page = await listScopeActivities(
      testDb,
      { id: viewerId, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit, cursor },
    );
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    sayfa += 1;
    if (sayfa > 100) throw new Error("sayfalama bitmiyor");
  } while (cursor);

  return { ids, sayfa };
}

describe("kapsam akışı sayfalaması", () => {
  it("101 kayıtta hiçbiri erişilemez kalmaz", async () => {
    const { director } = await companyWith(101);

    const { ids } = await tumSayfalar(director.id, 25);

    expect(ids).toHaveLength(101);
    // Tekrar eden kayıt yok: imleç aynı satırı iki kez vermiyor.
    expect(new Set(ids).size).toBe(101);
  });

  it("sayfa boyutu ne olursa olsun aynı sırayı verir", async () => {
    const { director } = await companyWith(60);

    const tekSayfa = await tumSayfalar(director.id, 200);
    const kucukSayfa = await tumSayfalar(director.id, 7);

    expect(tekSayfa.sayfa).toBe(1);
    expect(kucukSayfa.ids).toEqual(tekSayfa.ids);
  });

  it("liste bitince imleç boş döner", async () => {
    const { director } = await companyWith(5);

    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10 },
    );

    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it("bozuk imleç listenin başına döner, hata vermez", async () => {
    const { director } = await companyWith(3);

    for (const bozuk of ["", "abc", Buffer.from("{}").toString("base64url")]) {
      expect(decodeCursor(bozuk)).toBeNull();
    }

    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10, cursor: decodeCursor("abc") },
    );
    expect(page.items).toHaveLength(3);
  });

  it("imleç adres satırına yazılıp geri okunabilir", async () => {
    const { director } = await companyWith(30);

    const ilk = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10 },
    );
    expect(ilk.nextCursor).not.toBeNull();

    const cozulmus = decodeCursor(encodeCursor(ilk.nextCursor!));
    expect(cozulmus).toEqual(ilk.nextCursor);

    const ikinci = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10, cursor: cozulmus },
    );

    const ilkIdler = ilk.items.map((i) => i.id);
    expect(ikinci.items.some((item) => ilkIdler.includes(item.id))).toBe(false);
  });
});
