import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listFollowUps } from "@/server/follow-ups/read";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Takip listesinin süzgeçleri ve sayfalaması (Görev 11.3).
//
// Sayfa üç ayrı liste döndürüyordu (hareketsizler, bende, diğerleri). Ürün
// sahibi kararı (21.08.2026): **tek liste**, öncelik rozetlerle taşınıyor.
// Gruplu yapı sayfalanamıyordu — "3. sayfa" hangi grubun üçüncü sayfasıydı
// belirsizdi — ve süzgeç uygulanınca grupların anlamı kayboluyordu.
//
// Bilgi kaybı yok: hareketsizlik ve sahiplik satırın kendi alanlarında durur
// ve sıralama hareketsizleri öne alır.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const yabanci = await createUser(planlama.id, { fullName: "Planlamacı" });

  return { kaliphane, mudur, kadir, yabanci };
}

async function takipAc(
  yazan: { id: string; orgUnitId: string },
  sahip: { id: string },
  baslik: string,
  hareketAni: Date,
  status: "OPEN" | "CLOSED" = "OPEN",
) {
  const activity = await createActivity(yazan, { title: baslik });
  return testDb.followUpItem.create({
    data: {
      activityId: activity.id,
      openedById: yazan.id,
      ownerId: sahip.id,
      status,
      openedAt: hareketAni,
      lastMovedAt: hareketAni,
      ...(status === "CLOSED"
        ? { closedById: sahip.id, closedAt: NOW, closingNote: "Bitti" }
        : {}),
    },
  });
}

/** 12 iş günü öncesi: varsayılan eşiğin (5) üstünde. */
const COK_ESKI = new Date("2026-08-03T09:00:00.000Z");
const YENI = new Date("2026-08-18T09:00:00.000Z");

describe("durum süzgeci", () => {
  it("varsayılan olarak yalnız açık maddeleri getirir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, kadir, "Açık madde", YENI);
    await takipAc(kadir, kadir, "Kapalı madde", YENI, "CLOSED");

    const sonuc = await listFollowUps(testDb, { id: mudur.id, isSystemAdmin: false }, NOW, {});

    expect(sonuc.items.map((m) => m.activityTitle)).toEqual(["Açık madde"]);
  });

  it("kapalı seçilince yalnız kapananları getirir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, kadir, "Açık madde", YENI);
    await takipAc(kadir, kadir, "Kapalı madde", YENI, "CLOSED");

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      { status: "CLOSED" },
    );

    expect(sonuc.items.map((m) => m.activityTitle)).toEqual(["Kapalı madde"]);
  });
});

describe("sorumlu süzgeci", () => {
  it("yalnız seçilen kişinin maddelerini getirir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, kadir, "Kadir'de", YENI);
    await takipAc(kadir, mudur, "Müdürde", YENI);

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      { ownerId: kadir.id },
    );

    expect(sonuc.items.map((m) => m.activityTitle)).toEqual(["Kadir'de"]);
  });
});

describe("hareketsizlik süzgeci", () => {
  it("yalnız eşiği aşmış maddeleri getirir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, kadir, "Hareketsiz", COK_ESKI);
    await takipAc(kadir, kadir, "Taze", YENI);

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      { staleOnly: true },
    );

    expect(sonuc.items.map((m) => m.activityTitle)).toEqual(["Hareketsiz"]);
  });
});

describe("sıralama önceliği taşır", () => {
  // Grup başlıkları kalktı; öncelik sıralamada duruyor. En uzun bekleyen
  // madde en üstte olmalı — kullanıcı listeyi süzmeden de doğru yere bakar.
  it("en uzun hareketsiz kalan madde en üstte gelir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, kadir, "Taze", YENI);
    await takipAc(kadir, kadir, "Hareketsiz", COK_ESKI);

    const sonuc = await listFollowUps(testDb, { id: mudur.id, isSystemAdmin: false }, NOW, {});

    expect(sonuc.items[0]?.activityTitle).toBe("Hareketsiz");
  });
});

describe("sayfalama", () => {
  it("istenen kadar madde döndürür ve toplamı bildirir", async () => {
    const { mudur, kadir } = await sirket();
    for (const ad of ["Bir", "İki", "Üç"]) await takipAc(kadir, kadir, ad, YENI);

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      {},
      { limit: 2 },
    );

    expect(sonuc.items).toHaveLength(2);
    expect(sonuc.total).toBe(3);
  });
});

describe("süzgeç kapsam açmaz", () => {
  it("kapsam dışındaki maddeyi hiçbir süzgeçle getirmez", async () => {
    const { mudur, kadir, yabanci } = await sirket();
    await takipAc(yabanci, yabanci, "Başka birimin maddesi", COK_ESKI);
    await takipAc(kadir, kadir, "Kendi maddem", YENI);

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      { staleOnly: true },
    );

    expect(sonuc.items).toHaveLength(0);
  });
});

describe("sahiplik satırda taşınır", () => {
  // Grup başlığı ("Sorumlusu siz olanlar") kalktığı için bilgi satıra indi:
  // bakan kişi kendi maddesini rozetle ayırt eder.
  it("bakan kişinin kendi maddesi işaretlenir", async () => {
    const { mudur, kadir } = await sirket();
    await takipAc(kadir, mudur, "Müdürde", YENI);
    await takipAc(kadir, kadir, "Kadir'de", YENI);

    const sonuc = await listFollowUps(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      NOW,
      {},
    );

    const benim = sonuc.items.find((m) => m.activityTitle === "Müdürde");
    const digeri = sonuc.items.find((m) => m.activityTitle === "Kadir'de");

    expect(benim?.mine).toBe(true);
    expect(digeri?.mine).toBe(false);
  });
});
