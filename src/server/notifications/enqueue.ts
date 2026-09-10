import type { Prisma, PrismaClient } from "@prisma/client";

import { type NotificationEvent } from "./events";
import { readNotificationPolicy } from "./policy";

// Transactional outbox (§12.3): bildirim **iş işleminin içinde** veritabanına
// yazılır. Faaliyet kaydedilip bildirimin kaybolması mümkün olmasın diye;
// gönderim ayrı süreçte, ayrı zamanda yapılır.
//
// Idempotency anahtarı olay + hedef + nesneden kurulur ve tekil indekslidir.
// Aynı olay iki kez işlense de kullanıcıya tek bildirim gider.

export type EnqueueDb = Pick<PrismaClient, "notificationQueue" | "systemSetting"> &
  // Push aboneliklerine erişimi olmayan çağıran da olabilir (dar tipli test
  // çiftleri). O durumda yalnız e-posta yazılır; push sessizce atlanmaz,
  // **hiç denenmez** — kanal kurulu değil demektir.
  Partial<Pick<PrismaClient, "pushSubscription">>;

/**
 * Yükteki faaliyet kimliğini ayrı sütuna çıkarır.
 *
 * Kimlik yükün içinde zaten var; ama JSON alanına görünürlük koşulu
 * bağlanamıyor. Sütun, kutuyu ve göndericiyi görünürlük süzgecinden
 * geçirebilmek için (denetim 21.08.2026, bulgu 3).
 */
function faaliyetKimligi(payload: Prisma.InputJsonValue): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const deger = (payload as { activityId?: unknown }).activityId;
  return typeof deger === "string" ? deger : null;
}

export interface EnqueueParams {
  userId: string;
  eventType: NotificationEvent;
  payload: Prisma.InputJsonValue;
  /** Olay + hedef + nesne. Aynı anahtar ikinci kez yazılmaz. */
  idempotencyKey: string;
  now: Date;
}

/**
 * Bildirimi kuyruğa yazar. Aynı anahtar zaten varsa **sessizce geçer**: bu bir
 * hata değil, mükerrer korumasının ta kendisidir (§12.3). Sessiz geçilen tek
 * durum budur ve `false` dönüşüyle çağırana bildirilir.
 */
export async function enqueueNotification(
  db: EnqueueDb,
  params: EnqueueParams,
): Promise<boolean> {
  const policy = await readNotificationPolicy(db, params.eventType);
  if (!policy.enabled) return false;

  let inserted = 0;

  if (policy.email) {
    const created = await db.notificationQueue.createMany({
      data: {
        userId: params.userId,
        eventType: params.eventType,
        channel: "EMAIL",
        activityId: faaliyetKimligi(params.payload),
        payload: params.payload,
        idempotencyKey: params.idempotencyKey,
        createdAt: params.now,
      },
      skipDuplicates: true,
    });
    inserted += created.count;
  }

  if (policy.push) inserted += await enqueuePush(db, params);

  return inserted > 0;
}

/**
 * Push satırı (Görev 5.3b). E-postadan **ayrı bir kuyruk kaydıdır**: iki kanal
 * bağımsız denenir, biri başarısız olunca diğeri de yeniden gönderilmez.
 *
 * Yalnız aboneliği olan kişiye ve yalnız telefonu titretmeye değer olaylarda
 * yazılır. Aksi hâlde kuyruk, hiç gönderilemeyecek kayıtlarla dolardı.
 */
async function enqueuePush(db: EnqueueDb, params: EnqueueParams): Promise<number> {
  if (!db.pushSubscription) return 0;

  const abonelik = await db.pushSubscription.count({
    where: { userId: params.userId },
  });
  if (abonelik === 0) return 0;

  const created = await db.notificationQueue.createMany({
    data: {
      userId: params.userId,
      eventType: params.eventType,
      channel: "PUSH",
      activityId: faaliyetKimligi(params.payload),
      payload: params.payload,
      // Anahtar kanalla ayrışır; aynı olayın iki kanalı çakışmasın.
      idempotencyKey: `push:${params.idempotencyKey}`,
      createdAt: params.now,
    },
    skipDuplicates: true,
  });

  return created.count;
}
