import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { shutdownRealtimeHub, subscribe } from "@/server/realtime/hub";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Olayların **gerçek iş yollarından** çıktığının kanıtı (Görev 7.3).
//
// `publishRealtimeEvent`i doğrudan çağıran bir test, çağrının servise
// bağlandığını göstermez. Buradaki testler soru sorar, cevap yazar, konuşma
// kapatır, faaliyet iptal eder — ve akışa ne düştüğüne bakar.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const originalDatabaseUrl = process.env.DATABASE_URL;

function bekle(kutu: RealtimeEvent[], ms = 3_000): Promise<RealtimeEvent | null> {
  return new Promise((resolve) => {
    const baslangic = Date.now();
    const kontrol = () => {
      if (kutu.length > 0) return resolve(kutu[0]!);
      if (Date.now() - baslangic > ms) return resolve(null);
      setTimeout(kontrol, 20);
    };
    kontrol();
  });
}

beforeEach(async () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  await resetDatabase();
});

afterEach(async () => {
  await shutdownRealtimeHub();
  process.env.DATABASE_URL = originalDatabaseUrl;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function senaryo() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const director = await createUser(root.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  // Akran: bu faaliyeti göremez, dolayısıyla haberi de olmamalı (§8.1).
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Kalıp bakımı",
      description: "Haftalık bakım yapıldı.",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { director, author, peer, activity };
}

describe("iş yollarından çıkan olaylar", () => {
  it("soru sorulunca sorumlunun akışına düşer, akranın akışına düşmez", async () => {
    const { director, author, peer, activity } = await senaryo();

    const yazanin: RealtimeEvent[] = [];
    const akranin: RealtimeEvent[] = [];
    const birak1 = await subscribe(author.id, (e) => yazanin.push(e));
    const birak2 = await subscribe(peer.id, (e) => akranin.push(e));

    try {
      const sonuc = await askQuestion(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { activityId: activity.id, text: "Hangi kalıplar?" },
        NOW,
      );
      expect(sonuc.ok).toBe(true);

      expect(await bekle(yazanin)).toEqual({
        kind: REALTIME_EVENTS.questionAsked,
      });
      // Konuşmayı göremeyen kişi haberini de almaz.
      expect(akranin).toEqual([]);
    } finally {
      birak1();
      birak2();
    }
  });

  it("cevap yazılınca karşı tarafın akışına düşer", async () => {
    const { director, author, activity } = await senaryo();

    const acilan = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Hangi kalıplar?" },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum başarısız");

    const soranin: RealtimeEvent[] = [];
    const birak = await subscribe(director.id, (e) => soranin.push(e));

    try {
      const cevap = await replyToConversation(
        testDb,
        { id: author.id, isSystemAdmin: false },
        { conversationId: acilan.value.id, text: "Üç numaralı kalıp." },
        new Date(NOW.getTime() + 60_000),
      );
      expect(cevap.ok).toBe(true);

      expect(await bekle(soranin)).toEqual({
        kind: REALTIME_EVENTS.answerReceived,
      });
    } finally {
      birak();
    }
  });

  it("konuşma kapanınca taraflara düşer", async () => {
    const { director, author, activity } = await senaryo();

    const acilan = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Hangi kalıplar?" },
      NOW,
    );
    if (!acilan.ok) throw new Error("kurulum başarısız");

    const yazanin: RealtimeEvent[] = [];
    const birak = await subscribe(author.id, (e) => yazanin.push(e));

    try {
      const kapatma = await closeConversation(
        testDb,
        { id: director.id, isSystemAdmin: false },
        acilan.value.id,
        new Date(NOW.getTime() + 120_000),
      );
      expect(kapatma.ok).toBe(true);

      expect(await bekle(yazanin)).toEqual({
        kind: REALTIME_EVENTS.conversationClosed,
      });
    } finally {
      birak();
    }
  });

  it("faaliyet iptal edilince açık konuşmanın taraflarına düşer", async () => {
    const { director, author, activity } = await senaryo();

    await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Hangi kalıplar?" },
      NOW,
    );

    const soranin: RealtimeEvent[] = [];
    const birak = await subscribe(director.id, (e) => soranin.push(e));

    try {
      const iptal = await cancelActivity(
        testDb,
        { id: author.id, isSystemAdmin: false },
        activity.id,
        "Yanlış güne yazıldı.",
        new Date(NOW.getTime() + 180_000),
      );
      expect(iptal.ok).toBe(true);

      expect(await bekle(soranin)).toEqual({
        kind: REALTIME_EVENTS.activityCancelled,
      });
    } finally {
      birak();
    }
  });

  it("işlem geri alınırsa haber çıkmaz", async () => {
    const { director, author, activity } = await senaryo();

    const yazanin: RealtimeEvent[] = [];
    const birak = await subscribe(author.id, (e) => yazanin.push(e));

    try {
      // Aynı işlemde önce yayımlanır, sonra hata atılır: PostgreSQL bildirimi
      // yalnızca commit'te gönderdiği için akışa hiçbir şey düşmemeli.
      // "Yazılmamış değişikliğin haberi çıkmaz" güvencesinin kanıtı.
      await expect(
        testDb.$transaction(async (tx) => {
          const { publishRealtimeEvent } = await import("@/server/realtime/publish");
          await publishRealtimeEvent(tx, {
            kind: REALTIME_EVENTS.questionAsked,
            userIds: [author.id],
          });
          throw new Error("bilerek geri alındı");
        }),
      ).rejects.toThrow("bilerek geri alındı");

      expect(await bekle(yazanin, 600)).toBeNull();

      // Kurulum gerçekten çalışıyor mu: aynı yoldan geçen başarılı bir işlem
      // haberi çıkarıyor. Yoksa test yanlış nedenle yeşil kalırdı.
      const sonuc = await askQuestion(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { activityId: activity.id, text: "Hangi kalıplar?" },
        NOW,
      );
      expect(sonuc.ok).toBe(true);
      expect(await bekle(yazanin)).not.toBeNull();
    } finally {
      birak();
    }
  });
});
