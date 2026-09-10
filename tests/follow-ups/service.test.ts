import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { askQuestion } from "@/server/conversations/service";
import { listFollowUps } from "@/server/follow-ups/read";
import {
  closeFollowUp,
  openFollowUp,
  reopenFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Takip maddeleri (§11).
//
// Üç şey kritik:
//   1. Görünürlük — göremediğin faaliyetin maddesi sana görünmez.
//   2. Kapanış notu zorunlu — Excel'de ölen Açık/Kapalı sütununu yeniden
//      üretmemek için.
//   3. Bir faaliyetin aynı anda tek açık maddesi olur.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: kok.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const akran = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  return { genelMudur, mudur, calisan, akran };
}

const bakan = (id: string) => ({ id, isSystemAdmin: false });

async function onaylanmisKayit(
  yazan: { id: string; orgUnitId: string },
  baslik = "Kalıp bakımı",
) {
  return createActivity(yazan, { title: baslik, approvalStatus: "APPROVED" });
}

describe("açma", () => {
  it("kayıt sahibi takip açar ve sahibi olur", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);

    const sonuc = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id, nextStep: "Parça gelince haber ver" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.item.ownerId).toBe(calisan.id);
    expect(sonuc.item.nextStep).toBe("Parça gelince haber ver");

    // Olay geçmişi tutuluyor (§16.4): madde boolean değil.
    const olaylar = await testDb.followUpItemEvent.findMany({
      where: { followUpId: sonuc.item.id },
    });
    expect(olaylar.map((olay) => olay.kind)).toEqual(["OPENED"]);
  });

  it("faaliyeti göremeyen takip açamaz", async () => {
    const { calisan, akran } = await sirket();
    const activity = await onaylanmisKayit(calisan);

    const sonuc = await openFollowUp(
      testDb,
      bakan(akran.id),
      { activityId: activity.id },
      NOW,
    );

    // Kaydın varlığı da bildirilmez.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("activity_not_found");
  });

  it("bir faaliyetin ikinci açık maddesi olmaz", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    await openFollowUp(testDb, bakan(calisan.id), { activityId: activity.id }, NOW);

    const ikinci = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );

    // İki açık madde "bu konu kapandı mı" sorusunu cevapsız bırakırdı.
    expect(ikinci.ok).toBe(false);
    if (ikinci.ok) return;
    expect(ikinci.error).toBe("already_open");
  });

  it("iptal edilmiş faaliyete takip açılamaz", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    await cancelActivity(
      testDb,
      { id: calisan.id, isSystemAdmin: false },
      activity.id,
      "Yanlış girildi.",
      NOW,
    );

    const sonuc = await openFollowUp(
      testDb,
      bakan(mudur.id),
      { activityId: activity.id },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("activity_closed");
  });
});

describe("kapatma", () => {
  it("notsuz kapatılamaz", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await closeFollowUp(testDb, bakan(calisan.id), acilan.item.id, "   ", NOW);

    // Kapatmanın bedeli yoksa herkes kapatır ve kimse ne olduğunu bilmez.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("note_required");
  });

  it("sahibi notuyla kapatır; not kayıtta kalır", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await closeFollowUp(
      testDb,
      bakan(calisan.id),
      acilan.item.id,
      "Parça geldi, 22 Ağustos'ta takıldı.",
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const kayit = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: acilan.item.id },
    });
    expect(kayit.status).toBe("CLOSED");
    expect(kayit.closingNote).toContain("22 Ağustos");
    expect(kayit.closedById).toBe(calisan.id);
  });

  it("sahibinin üstü de kapatabilir", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await closeFollowUp(
      testDb,
      bakan(mudur.id),
      acilan.item.id,
      "Konu bende kapandı.",
      NOW,
    );

    expect(sonuc.ok).toBe(true);
  });

  it("ilgisiz kişi kapatamaz", async () => {
    const { calisan, akran } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await closeFollowUp(
      testDb,
      bakan(akran.id),
      acilan.item.id,
      "Ben kapatıyorum.",
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("not_allowed");
  });

  it("kapalı madde gerekçeyle yeniden açılır", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");
    await closeFollowUp(testDb, bakan(calisan.id), acilan.item.id, "Kapandı.", NOW);

    const sonuc = await reopenFollowUp(
      testDb,
      bakan(calisan.id),
      acilan.item.id,
      "Parça bozuk çıktı.",
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const olaylar = await testDb.followUpItemEvent.findMany({
      where: { followUpId: acilan.item.id },
      orderBy: { createdAt: "asc" },
    });
    expect(olaylar.map((olay) => olay.kind)).toEqual([
      "OPENED",
      "CLOSED",
      "REOPENED",
    ]);
  });
});

describe("devir", () => {
  it("faaliyeti göremeyen kişiye devredilemez", async () => {
    const { calisan, akran } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await transferFollowUp(
      testDb,
      bakan(calisan.id),
      acilan.item.id,
      akran.id,
      NOW,
    );

    // Takip edemeyeceği bir iş üstlenmiş olurdu.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("owner_cannot_see");
  });

  it("kapsamdaki kişiye devredilir ve iz bırakır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonuc = await transferFollowUp(
      testDb,
      bakan(calisan.id),
      acilan.item.id,
      mudur.id,
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.item.ownerId).toBe(mudur.id);

    const iz = await testDb.auditLog.findFirst({
      where: {
        objectId: acilan.item.id,
        action: AUDIT_ACTIONS.followUpTransferred,
      },
    });
    expect(iz).not.toBeNull();
  });
});

describe("son hareket", () => {
  it("faaliyete soru gelince hareketsizlik sayacı sıfırlanır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    const sonra = new Date("2026-08-25T09:00:00.000Z");
    await askQuestion(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Bu ne durumda?" },
      sonra,
    );

    const kayit = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: acilan.item.id },
    });
    // Konuşma sürüyorsa konu ölü değildir (§11.1).
    expect(kayit.lastMovedAt.toISOString()).toBe(sonra.toISOString());
  });
});

describe("iptal yan etkisi", () => {
  it("faaliyet iptal edilince açık madde otomatik kapanır", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");

    await cancelActivity(
      testDb,
      { id: calisan.id, isSystemAdmin: false },
      activity.id,
      "Yanlış girildi.",
      NOW,
    );

    const kayit = await testDb.followUpItem.findUniqueOrThrow({
      where: { id: acilan.item.id },
    });
    // Açık bırakmak, kimsenin kapatamayacağı bir madde üretirdi.
    expect(kayit.status).toBe("CLOSED");
    expect(kayit.closingNote).toBe("Faaliyet iptal edildi.");
  });
});

describe("listeleme ve görünürlük", () => {
  it("göremediği faaliyetin maddesi listede yok", async () => {
    const { calisan, akran } = await sirket();
    const activity = await onaylanmisKayit(calisan, "Gizli konu");
    await openFollowUp(testDb, bakan(calisan.id), { activityId: activity.id }, NOW);

    const liste = await listFollowUps(testDb, bakan(akran.id), NOW);

    // Başlık ve "sonraki adım" metni de içerik taşır.
    expect(liste.items).toHaveLength(0);
  });

  it("yöneticinin kapsamındaki madde listede", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    await openFollowUp(testDb, bakan(calisan.id), { activityId: activity.id }, NOW);

    const liste = await listFollowUps(testDb, bakan(mudur.id), NOW);

    expect(liste.items).toHaveLength(1);
    // Sahibi bakan kişi değil; sahiplik satırın kendi alanında duruyor.
    expect(liste.items[0]?.ownerId).not.toBe(mudur.id);
  });

  it("hareketsiz madde işaretlenir", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      new Date("2026-08-05T09:00:00.000Z"),
    );
    if (!acilan.ok) throw new Error("kurulum");

    const liste = await listFollowUps(testDb, bakan(calisan.id), NOW);

    // Hareketsizlik artık ayrı liste değil, satırın kendi alanı (Görev 11.3).
    expect(liste.items).toHaveLength(1);
    expect(liste.items[0]?.stale).toBe(true);
    expect(liste.items[0]?.idleBusinessDays).toBeGreaterThanOrEqual(5);
  });

  it("kapanan madde listeden düşer", async () => {
    const { calisan } = await sirket();
    const activity = await onaylanmisKayit(calisan);
    const acilan = await openFollowUp(
      testDb,
      bakan(calisan.id),
      { activityId: activity.id },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum");
    await closeFollowUp(testDb, bakan(calisan.id), acilan.item.id, "Bitti.", NOW);

    const liste = await listFollowUps(testDb, bakan(calisan.id), NOW);

    expect(liste.items).toHaveLength(0);
  });
});
