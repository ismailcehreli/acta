import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { updateActivity } from "@/server/activities/write";
import { askQuestion, replyToConversation } from "@/server/conversations/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

// Denetim (18.08.2026, FAZ 4 bulgu 2 ve 3): iptal, düzeltme ve soru
// açma aynı kilit protokolüne katılmıyordu. İptalin "geri alınamaz" ve "açık
// konuşmaları kapatır" sonuçları garanti değildi.
//
// Yarışı kurmak için iki ayrı bağlantı ve buluşma noktası gerekir; tek
// istemciden art arda gönderilen çağrılar sıraya girer ve hiçbir şey kanıtlamaz.

const NOW = new Date("2026-08-17T09:00:00.000Z");

const clientA = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });
const clientB = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } }, log: [] });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all([testDb.$disconnect(), clientA.$disconnect(), clientB.$disconnect()]);
});

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

async function scenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });

  const director = await createUser(root.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "İlk başlık",
      description: "İlk açıklama",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { director, author, activity, moldShop };
}

/**
 * Yarışın hangi sırayla çözüleceği rastgeledir; "iki isteği aynı anda gönder"
 * biçiminde bir test, kilit kaldırıldığında da yeşil kalabilir. Bu yüzden
 * pencere elle açılır: dış bir işlem satırı `FOR UPDATE` ile tutar, sınanan
 * çağrı ön okumasını yaptıktan sonra kilitte bekler, ardından satırın durumu
 * değiştirilip işlem tamamlanır. Kilit yoksa çağrı beklemez ve eskimiş
 * durumla yazar.
 *
 * Kilidi tutan taraf gerçek `cancelActivity`/`closeConversation` yerine ham
 * güncelleme yapar; ikisi de aynı satırı `FOR UPDATE` ile kilitlediği için
 * dışarıdan görünen davranış aynıdır ve iç içe işlem açma sorunu doğmaz.
 */
async function withRowLockedThen<T>(
  table: "Activity" | "Conversation",
  id: string,
  mutate: (tx: PrismaClient) => Promise<unknown>,
  during: () => Promise<T>,
): Promise<T> {
  let lockAcquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  let releaseHolder!: () => void;
  const holderMayFinish = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });

  const holder = clientA.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`,
        id,
      );
      lockAcquired();
      await holderMayFinish;
      await mutate(tx as unknown as PrismaClient);
    },
    { timeout: 20_000, maxWait: 20_000 },
  );

  await locked;
  const pending = during();
  // Beklemeyi ölçen yarış hata fırlatsa bile işlem kapatılmalı; açık kalan bir
  // işlem sonraki testin TRUNCATE'ini süresiz kilitler.
  pending.catch(() => undefined);

  try {
    // Çağrının kilitte gerçekten beklediğini görmek için kısa bir soluk: bu
    // süre içinde çözülürse kilit protokolüne hiç girmemiş demektir.
    const erkenBiten = await Promise.race([
      pending.then(() => "bitti" as const),
      new Promise<"bekliyor">((resolve) => setTimeout(() => resolve("bekliyor"), 300)),
    ]);
    expect(erkenBiten).toBe("bekliyor");
  } finally {
    releaseHolder();
    await holder.catch(() => undefined);
  }

  return pending;
}

describe("düzeltme ile iptal yarışı", () => {
  it("iptal kazanınca düzeltme yazamaz", async () => {
    const { author, activity, moldShop } = await scenario();

    const sonuc = await withRowLockedThen(
      "Activity",
      activity.id,
      (tx) =>
        tx.activity.update({
          where: { id: activity.id },
          data: { approvalStatus: "CANCELLED" },
        }),
      () =>
        updateActivity(
          clientB as never,
          author.id,
          {
            id: activity.id,
            activityDate: "2026-08-17",
            title: "Düzeltilmiş başlık",
            description: "Düzeltilmiş açıklama",
            targetDepartmentIds: [moldShop.id],
          },
          new Date(NOW.getTime() + 60_000),
        ),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("conflict");

    const stored = await testDb.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(stored.title).toBe("İlk başlık");
    expect(stored.currentRevisionNo).toBe(1);
  });
});

describe("soru açma ile iptal yarışı", () => {
  it("iptal kazanınca yeni konuşma açılmaz", async () => {
    const { director, activity } = await scenario();

    const sonuc = await withRowLockedThen(
      "Activity",
      activity.id,
      (tx) =>
        tx.activity.update({
          where: { id: activity.id },
          data: { approvalStatus: "CANCELLED" },
        }),
      () =>
        askQuestion(
          clientB as never,
          { id: director.id, isSystemAdmin: false },
          { activityId: activity.id, text: "Bu ne durumda?" },
          new Date(NOW.getTime() + 60_000),
        ),
    );

    expect(sonuc.ok).toBe(false);

    // İptal edilmiş faaliyette hiç konuşma kalmamalı — açığı da kapalısı da.
    expect(await testDb.conversation.count({ where: { activityId: activity.id } })).toBe(0);
  });
});

describe("kapatma ile cevap yarışı", () => {
  it("kapanan konuşmaya cevap yazılamaz", async () => {
    const { author, director, activity } = await scenario();

    const acilan = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Bu ne durumda?" },
      new Date(NOW.getTime() + 60_000),
    );
    if (!acilan.ok) throw new Error("kurulum başarısız");

    const sonuc = await withRowLockedThen(
      "Conversation",
      acilan.value.id,
      (tx) =>
        tx.conversation.update({
          where: { id: acilan.value.id },
          data: { status: "CLOSED", closedAt: NOW, closedById: director.id, closeType: "NORMAL" },
        }),
      () =>
        replyToConversation(
          clientB as never,
          { id: author.id, isSystemAdmin: false },
          { conversationId: acilan.value.id, text: "Tamamlandı." },
          new Date(NOW.getTime() + 120_000),
        ),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("closed");

    // Kapalı konuşmada yalnız ilk soru kalmalı.
    expect(
      await testDb.conversationMessage.count({
        where: { conversationId: acilan.value.id },
      }),
    ).toBe(1);
  });
});

describe("okuma kaydının değişmezi", () => {
  // İki sekme açıkken sıra karışabilir: geç yazan istek erken zaman damgası
  // taşıyabilir. "İlk okuma" ileri kaymamalı, "son okuma" geri gitmemeli.
  // Yarışın hangi sırayla çözüleceği belirsiz olduğu için değişmez doğrudan
  // sınanır: geç zaman önce, erken zaman sonra yazılır.
  it("sonradan gelen erken zaman damgası değişmezi bozmaz", async () => {
    const { director, activity } = await scenario();
    const { markActivityAsRead } = await import("@/server/reads/service");

    const erken = new Date(NOW.getTime() + 60_000);
    const gec = new Date(NOW.getTime() + 120_000);
    const viewer = { id: director.id, isSystemAdmin: false };

    await markActivityAsRead(testDb, viewer, activity.id, 3_000, gec);
    await markActivityAsRead(testDb, viewer, activity.id, 3_000, erken);

    const kayit = await testDb.readReceipt.findUniqueOrThrow({
      where: { activityId_userId: { activityId: activity.id, userId: director.id } },
    });

    expect(kayit.firstReadAt).toEqual(erken);
    expect(kayit.lastReadAt).toEqual(gec);
  });

  it("eşzamanlı iki okuma tek satır bırakır", async () => {
    const { director, activity } = await scenario();
    const { markActivityAsRead } = await import("@/server/reads/service");
    const barrier = createBarrier(2);
    const viewer = { id: director.id, isSystemAdmin: false };

    const sonuclar = await Promise.allSettled([
      (async () => {
        await barrier();
        return markActivityAsRead(clientA as never, viewer, activity.id, 3_000, NOW);
      })(),
      (async () => {
        await barrier();
        return markActivityAsRead(clientB as never, viewer, activity.id, 3_000, NOW);
      })(),
    ]);

    // Eşzamanlı yazım hata vermemeli (tekil anahtar ihlali yok) ve tek satır
    // kalmalı.
    expect(sonuclar.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await testDb.readReceipt.count()).toBe(1);
  });
});
