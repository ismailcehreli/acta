import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeOpenConversationsForUser } from "@/server/conversations/close-for-deactivation";
import { askQuestion } from "@/server/conversations/service";
import { deactivateUser } from "@/server/users/deactivate";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Plan açık soru 12 (ürün sahibi kararı 18.08.2026): idari kapatmanın yeri
// pasifleştirme akışıdır. Kilit orada doğuyor — §4.6 açık konuşması olan
// kullanıcının pasifleştirilmesini engelliyor, §9.3 kapatmayı idari işleme
// bağlıyor.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function acikKonusmali() {
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
  const sysAdmin = await createUser(root.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  const soru = await askQuestion(
    testDb,
    { id: director.id, isSystemAdmin: false },
    { activityId: activity.id, text: "Bu ne durumda?" },
    NOW,
  );
  if (!soru.ok) throw new Error("kurulum");

  return { director, author, sysAdmin, conversation: soru.value };
}

const admin = (user: { id: string }) => ({ id: user.id, isSystemAdmin: true });

describe("pasifleştirme önündeki konuşmaların kapatılması", () => {
  // Faaliyeti yazan kişi üzerinden sınanır: direktörün altında kullanıcı
  // olduğu için onu pasifleştirmenin önünde ayrıca §4.4 engeli vardır ve
  // konuşma kapatmakla ilgisi yoktur.
  it("gerekçeyle kapatır ve pasifleştirmenin önünü açar", async () => {
    const { author, sysAdmin } = await acikKonusmali();

    // Önce engellenmeli.
    const engelli = await deactivateUser(testDb, author.id, NOW);
    expect(engelli.ok).toBe(false);
    if (engelli.ok) return;
    expect(engelli.reason).toBe("blocked");

    const sonuc = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      author.id,
      "Kullanıcı işten ayrıldı.",
      NOW,
    );

    expect(sonuc).toEqual({ closed: 1, failed: 0 });

    const kapali = await testDb.conversation.findFirstOrThrow();
    expect(kapali.status).toBe("CLOSED");
    expect(kapali.closeType).toBe("ADMINISTRATIVE");
    expect(kapali.closeReason).toBe("Kullanıcı işten ayrıldı.");
    expect(kapali.closedById).toBe(sysAdmin.id);

    // Artık pasifleştirilebilir.
    const sonra = await deactivateUser(testDb, author.id, NOW);
    expect(sonra.ok).toBe(true);
  });

  it("soruyu soran taraf için de çalışır", async () => {
    const { director, sysAdmin } = await acikKonusmali();

    const sonuc = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      director.id,
      "Görev değişikliği.",
      NOW,
    );

    expect(sonuc).toEqual({ closed: 1, failed: 0 });
  });

  it("gerekçesiz çağrı hiçbir konuşmayı kapatmaz", async () => {
    const { director, sysAdmin } = await acikKonusmali();

    const sonuc = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      director.id,
      "   ",
      NOW,
    );

    expect(sonuc).toEqual({ closed: 0, failed: 1 });
    expect(
      await testDb.conversation.count({ where: { status: "OPEN" } }),
    ).toBe(1);
  });

  it("sistem yöneticisi olmayan kimse toplu kapatamaz", async () => {
    const { director, author } = await acikKonusmali();

    // Faaliyeti yazan kişi konuşmanın sorumlusudur; §9.3 sorumluya kapatma
    // yetkisi vermez, toplu yol da bunu değiştirmez.
    const sonuc = await closeOpenConversationsForUser(
      testDb,
      { id: author.id, isSystemAdmin: false },
      director.id,
      "Kapatmak istiyorum.",
      NOW,
    );

    expect(sonuc).toEqual({ closed: 0, failed: 1 });
    expect(
      await testDb.conversation.count({ where: { status: "OPEN" } }),
    ).toBe(1);
  });

  it("kapatılacak konuşma yoksa sessizce biter", async () => {
    const { sysAdmin } = await acikKonusmali();

    const sonuc = await closeOpenConversationsForUser(
      testDb,
      admin(sysAdmin),
      sysAdmin.id,
      "Gerekçe.",
      NOW,
    );

    expect(sonuc).toEqual({ closed: 0, failed: 0 });
  });
});
