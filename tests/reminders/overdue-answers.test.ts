import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addHoliday, DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import { askQuestion, replyToConversation } from "@/server/conversations/service";
import {
  OVERDUE_ANSWER_BUSINESS_DAYS,
  sendOverdueAnswerReminders,
} from "@/worker/reminders/overdue-answers";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "3 iş günüdür cevap yok" (§12.2): sorumluya **ve yöneticisine** gider.
//
// Sayaç sorumluluğun **son el değiştirdiği** andan işler (ürün sahibi kararı,
// 18.08.2026): konuşmanın açılışından ölçmek, canlı bir tartışmanın ortasında
// da hatırlatma göndermek demekti.
//
// Bu kural §9.3'teki 10 iş günüyle aynı şey değildir: o, soranın üstüne
// kapatma yetkisi verir; bu, cevap vermeyene hatırlatma gönderir.

const ACILIS = new Date("2026-08-17T09:00:00.000Z"); // Pazartesi

beforeEach(async () => {
  await resetDatabase();
  await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR);
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function acikKonusma() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: kalipMudur.id,
      authorOrgUnitId: kaliphane.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus: "APPROVED",
      createdAt: ACILIS,
      updatedAt: ACILIS,
    },
  });

  const soru = await askQuestion(
    testDb,
    { id: genelMudur.id, isSystemAdmin: false },
    { activityId: activity.id, text: "Bu ne durumda?" },
    ACILIS,
  );
  if (!soru.ok) throw new Error("kurulum");

  // Soru bildirimi kuyrukta duruyor; hatırlatmaları ondan ayırt edebilmek için
  // temizlenir.
  await testDb.notificationQueue.deleteMany({});

  return { genelMudur, kalipMudur, conversation: soru.value };
}

async function hatirlatmalar() {
  return testDb.notificationQueue.findMany({
    where: { eventType: "answer_overdue" },
  });
}

describe("üç iş günü sayacı", () => {
  it("üç iş günü dolmadan hatırlatma gitmez", async () => {
    await acikKonusma();
    // Perşembe: 18, 19 → iki iş günü.
    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-19T09:00:00.000Z"),
    );

    expect(sonuc.overdueConversations).toBe(0);
    expect(await hatirlatmalar()).toHaveLength(0);
  });

  it("üç iş günü dolunca sorumluya ve yöneticisine gider", async () => {
    const { genelMudur, kalipMudur } = await acikKonusma();
    // 18, 19, 20 → üç iş günü.
    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(OVERDUE_ANSWER_BUSINESS_DAYS).toBe(3);
    expect(sonuc.overdueConversations).toBe(1);
    expect(sonuc.queued).toBe(2);

    const alicilar = (await hatirlatmalar()).map((k) => k.userId).sort();
    // Sorumlu faaliyeti yazan kişidir; yöneticisi Genel Müdür.
    expect(alicilar).toEqual([kalipMudur.id, genelMudur.id].sort());
  });

  it("hafta sonu sayacı ilerletmez", async () => {
    await acikKonusma();
    // Cuma bekleyen bir konuşma için Pazartesi henüz üç iş günü değildir.
    // Mesaj silinmez (veritabanı silmeyi engelliyor); zamanı geriye alınır.
    const cuma = new Date("2026-08-21T09:00:00.000Z");
    await testDb.conversationMessage.updateMany({ data: { createdAt: cuma } });
    await testDb.conversation.updateMany({ data: { openedAt: cuma } });

    const pazartesi = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );
    expect(pazartesi.overdueConversations).toBe(0);

    // Çarşamba: 24, 25, 26 → üç iş günü.
    const carsamba = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-26T09:00:00.000Z"),
    );
    expect(carsamba.overdueConversations).toBe(1);
  });

  it("resmî tatil sayacı geciktirir", async () => {
    await acikKonusma();
    await addHoliday(testDb, { date: "2026-08-19", description: "Deneme tatili" });

    // 18, (19 tatil), 20 → iki iş günü.
    const persembe = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );
    expect(persembe.overdueConversations).toBe(0);

    // 21 ile üçüncü iş günü dolar.
    const cuma = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );
    expect(cuma.overdueConversations).toBe(1);
  });
});

describe("sayaç sorumluluk el değiştirince sıfırlanır", () => {
  it("cevap gelince sayaç yeniden başlar", async () => {
    const { kalipMudur, conversation } = await acikKonusma();

    // İki gün sonra cevap yazılır: sıra sorana geçer.
    const cevapAni = new Date("2026-08-19T09:00:00.000Z");
    const cevap = await replyToConversation(
      testDb,
      { id: kalipMudur.id, isSystemAdmin: false },
      { conversationId: conversation.id, text: "Bakılıyor." },
      cevapAni,
    );
    expect(cevap.ok).toBe(true);
    await testDb.notificationQueue.deleteMany({});

    // Açılıştan itibaren üç iş günü doldu ama cevaptan itibaren dolmadı.
    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );
    expect(sonuc.overdueConversations).toBe(0);

    // Cevaptan üç iş günü sonra hatırlatma gider — bu kez soran taraf bekliyor.
    const sonraki = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-24T09:00:00.000Z"),
    );
    expect(sonraki.overdueConversations).toBe(1);
  });
});

describe("kapalı konuşma ve tekrar", () => {
  it("kapalı konuşma için hatırlatma gitmez", async () => {
    await acikKonusma();
    await testDb.conversation.updateMany({
      data: {
        status: "CLOSED",
        closedAt: ACILIS,
        closeType: "NORMAL",
      },
    });

    const sonuc = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(sonuc.overdueConversations).toBe(0);
  });

  it("aynı bekleyiş için ikinci kez hatırlatma yazılmaz", async () => {
    await acikKonusma();
    const an = new Date("2026-08-20T09:00:00.000Z");

    await sendOverdueAnswerReminders(testDb, an);
    const ikinci = await sendOverdueAnswerReminders(
      testDb,
      new Date("2026-08-21T09:00:00.000Z"),
    );

    expect(ikinci.queued).toBe(0);
    expect(await hatirlatmalar()).toHaveLength(2);
  });
});
