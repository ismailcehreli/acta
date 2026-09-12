import type { Prisma, PrismaClient } from "@prisma/client";

import { type NotificationEvent } from "./events";
import { readNotificationPolicy } from "./policy";




//



export type EnqueueDb = Pick<PrismaClient, "notificationQueue" | "systemSetting"> &



  Partial<Pick<PrismaClient, "pushSubscription">>;


function activityIdFromPayload(payload: Prisma.InputJsonValue): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as { activityId?: unknown }).activityId;
  return typeof value === "string" ? value : null;
}

export interface EnqueueParams {
  userId: string;
  eventType: NotificationEvent;
  payload: Prisma.InputJsonValue;

  idempotencyKey: string;
  now: Date;
}


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
        activityId: activityIdFromPayload(params.payload),
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


async function enqueuePush(db: EnqueueDb, params: EnqueueParams): Promise<number> {
  if (!db.pushSubscription) return 0;

  const subscriptionCount = await db.pushSubscription.count({
    where: { userId: params.userId },
  });
  if (subscriptionCount === 0) return 0;

  const created = await db.notificationQueue.createMany({
    data: {
      userId: params.userId,
      eventType: params.eventType,
      channel: "PUSH",
      activityId: activityIdFromPayload(params.payload),
      payload: params.payload,

      idempotencyKey: `push:${params.idempotencyKey}`,
      createdAt: params.now,
    },
    skipDuplicates: true,
  });

  return created.count;
}
