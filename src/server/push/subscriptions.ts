import type { PrismaClient } from "@prisma/client";

// Tarayıcı push abonelikleri (§12.3, Görev 5.3b).
//
// Bir kişinin birden çok cihazı olabilir; her tarayıcı ayrı abonelik üretir.
// Abonelik **kişiye bağlıdır**: kimin adına kaydedildiği oturumdan gelir,
// istemcinin gönderdiği bir kimlikten değil.

export type SubscriptionDb = Pick<PrismaClient, "pushSubscription">;

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

export interface StoredSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Aboneliği kaydeder ya da tazeler.
 *
 * Aynı `endpoint` başka bir kullanıcıya bağlıysa **sahibi değişir**: ortak
 * kullanılan bir tarayıcıda ikinci kişi giriş yaptığında bildirimler eski
 * kullanıcıya gitmeye devam etseydi, kayıt sızıntısı olurdu.
 */
export async function saveSubscription(
  db: SubscriptionDb,
  userId: string,
  input: SubscriptionInput,
  now: Date = new Date(),
): Promise<StoredSubscription> {
  const userAgent = (input.userAgent ?? "").slice(0, 300) || null;

  return db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent,
      createdAt: now,
    },
    update: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent,
      // Tazelenen abonelik yeniden sağlıklı sayılır.
      failureCount: 0,
    },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
}

/**
 * Aboneliği kaldırır. **Yalnız kendi aboneliğini** kaldırabilir: başkasının
 * endpoint'ini gönderen biri onun bildirimlerini kapatabilirdi.
 */
export async function removeSubscription(
  db: SubscriptionDb,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const silinen = await db.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });
  return silinen.count > 0;
}

/**
 * Ölü aboneliği düşürür. Push servisi 404/410 döndüğünde abonelik kalıcı
 * olarak yok demektir; tutmak her turda boşuna denemek olurdu.
 *
 * Bu, §16.6'daki silme yasağının kapsamında değildir: abonelik bir iş kaydı
 * değil, bir cihaz bağlantısıdır — tarayıcı onu zaten silmiştir.
 */
export async function dropSubscription(
  db: SubscriptionDb,
  endpoint: string,
): Promise<void> {
  await db.pushSubscription.deleteMany({ where: { endpoint } });
}

export async function listSubscriptions(
  db: SubscriptionDb,
  userId: string,
): Promise<StoredSubscription[]> {
  return db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
}

export async function countSubscriptions(
  db: SubscriptionDb,
  userId: string,
): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}
