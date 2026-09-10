import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { askQuestion } from "@/server/conversations/service";
import { openFollowUp, touchFollowUps } from "@/server/follow-ups/service";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Takip maddesinin **hareketi** (§11.1; denetim 23.08.2026, P3-R3-4
// ve P3-R3-5).
//
// Hareket iki şey taşımak zorunda: ne zaman olduğu (skorun geçmiş dönem
// hesabı buna bakıyor) ve **kim** yaptığı (olay geçmişi "kim ne zaman ne
// yaptı" kaydıdır). Ayrıca sayaç geriye gidemez: gecikmiş bir istek daha
// yeni bir hareketin üstüne eski zamanı yazarsa, takip listesi aktif bir
// maddeyi "uzun süredir hareketsiz" gösterir.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kurulum() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const mudur = await createUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  const kayit = await createActivity(kadir, {
    activityDate: new Date("2026-08-03T00:00:00.000Z"),
  });

  const madde = await openFollowUp(
    testDb,
    { id: kadir.id, isSystemAdmin: false },
    { activityId: kayit.id, nextStep: "Bekliyor" },
    new Date("2026-08-03T09:00:00.000Z"),
  );
  if (!madde.ok) throw new Error("madde açılamadı");

  return { mudur, kadir, kayit, madde: madde.item };
}

describe("hareket olayı", () => {
  it("hareketi yapan kişiyi taşır", async () => {
    const { mudur, kayit, madde } = await kurulum();

    // Soruyu **müdür** sordu; madde sahibi çalışan.
    await askQuestion(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      { activityId: kayit.id, text: "Bu iş ne durumda?" },
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const olay = await testDb.followUpItemEvent.findFirstOrThrow({
      where: { followUpId: madde.id, kind: "TOUCHED" },
    });

    // Hiç işlem yapmayan kişiye işlem yüklenmemeli.
    expect(olay.actorId).toBe(mudur.id);
  });

  it("son hareket geriye gitmez", async () => {
    const { mudur, kayit, madde } = await kurulum();

    await touchFollowUps(
      testDb,
      kayit.id,
      mudur.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );
    // Gecikmiş istek: daha **eski** bir anla geliyor.
    await touchFollowUps(
      testDb,
      kayit.id,
      mudur.id,
      new Date("2026-08-04T09:00:00.000Z"),
    );

    const taze = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: madde.id },
    });

    expect(taze.lastMovedAt.toISOString()).toBe("2026-08-05T09:00:00.000Z");
  });

  it("kapanmış madde yeniden hareket görmez", async () => {
    const { mudur, kadir, kayit, madde } = await kurulum();
    await testDb.followUpItem.update({
      where: { id: madde.id },
      data: {
        status: "CLOSED",
        closedAt: new Date("2026-08-04T09:00:00.000Z"),
        closedById: kadir.id,
        closingNote: "Bitti",
      },
    });

    await touchFollowUps(
      testDb,
      kayit.id,
      mudur.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    const olaylar = await testDb.followUpItemEvent.count({
      where: { followUpId: madde.id, kind: "TOUCHED" },
    });

    expect(olaylar).toBe(0);
  });
});

// Yarış penceresi (denetim 23.08.2026, P3-R4-4).
//
// Koşul testleri `GREATEST` ve `WHERE status = 'OPEN'` satırlarını ölçüyor
// ama asıl bulgunun ikinci yarısı **kapatma ile dokunmanın yarışıydı**. Kod
// tekrar "önce oku, sonra kimlikle yaz" biçimine bölünse ardışık testler
// yeşil kalır; kapanma tam o pencereye girdiğinde oluşan hata görünmez.
describe("kapatma ile hareket yarışı", () => {
  it("kapatma kazanırsa hareket olayı oluşmaz", async () => {
    const { mudur, kadir, kayit, madde } = await kurulum();

    let kapatmaBitti = () => {};
    const kapatmaTamam = new Promise<void>((c) => (kapatmaBitti = c));
    let devamEt = () => {};
    const devam = new Promise<void>((c) => (devamEt = c));

    // Kapatma işlemi satırı kilitliyor ve commit etmeden bekliyor.
    const kapatma = testDb.$transaction(async (tx) => {
      await tx.followUpItem.update({
        where: { id: madde.id },
        data: {
          status: "CLOSED",
          closedAt: new Date("2026-08-04T09:00:00.000Z"),
          closedById: kadir.id,
          closingNote: "Bitti",
        },
      });
      kapatmaBitti();
      await devam;
    });

    await kapatmaTamam;

    // Dokunma tam bu pencerede geliyor: satır kilitli, kapatma henüz
    // commit edilmedi.
    const dokunma = touchFollowUps(
      testDb,
      kayit.id,
      mudur.id,
      new Date("2026-08-05T09:00:00.000Z"),
    );

    await new Promise((c) => setTimeout(c, 150));
    devamEt();
    await kapatma;
    await dokunma;

    const olaylar = await testDb.followUpItemEvent.count({
      where: { followUpId: madde.id, kind: "TOUCHED" },
    });
    const taze = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: madde.id },
    });

    // Kapatma kazandı: madde kapandıktan sonra hareket görmemeli.
    expect(olaylar).toBe(0);
    expect(taze.lastMovedAt.toISOString()).not.toBe("2026-08-05T09:00:00.000Z");
  });
});
