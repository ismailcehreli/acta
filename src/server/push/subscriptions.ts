import type { PrismaClient } from "@prisma/client";


//




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

      failureCount: 0,
    },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
}


export async function removeSubscription(
  db: SubscriptionDb,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const deleted = await db.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });
  return deleted.count > 0;
}


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
