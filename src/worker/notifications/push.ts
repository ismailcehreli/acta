import type { PrismaClient } from "@prisma/client";

import { renderLine } from "@/server/notifications/templates";
import { createTranslator, DEFAULT_LOCALE } from "@/shared/i18n";
import {
  dropSubscription,
  listSubscriptions,
} from "@/server/push/subscriptions";
import { isExhausted, isRetryDue, MAX_ATTEMPTS } from "@/server/notifications/schedule";
import { readVapidKeys } from "@/server/settings/vapid";
import {
  partitionRowsByVisibility,
  type VisibleRowsDb,
} from "@/server/notifications/visible-rows";


//



//




export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface PushEndpoint {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendOutcome =
  | { ok: true }

  | { ok: false; gone: true }
  | { ok: false; gone: false; message: string };

export interface PushTransport {
  send(
    endpoint: PushEndpoint,
    message: PushMessage,
    keys: { publicKey: string; privateKey: string; subject: string },
  ): Promise<PushSendOutcome>;
}

export type PushDispatcherDb = Pick<
  PrismaClient,
  "notificationQueue" | "pushSubscription" | "systemSetting" | "auditLog" | "$transaction"
> &
  VisibleRowsDb;

export interface PushDispatchResult {
  sent: number;
  delivered: number;
  failed: number;
  givenUp: number;

  droppedSubscriptions: number;

  cancelled: number;
}

const EMPTY_RESULT: PushDispatchResult = {
  sent: 0,
  delivered: 0,
  failed: 0,
  givenUp: 0,
  droppedSubscriptions: 0,
  cancelled: 0,
};

export async function dispatchPushNotifications(
  db: PushDispatcherDb,
  transport: PushTransport,
  options: { now: Date; baseUrl: string; maxItems?: number },
): Promise<PushDispatchResult> {
  const { now, baseUrl, maxItems = 200 } = options;

  const keys = await readVapidKeys(db);
  if (!keys) {


    return EMPTY_RESULT;
  }

  const pending = await db.notificationQueue.findMany({
    where: { status: "PENDING", channel: "PUSH" },
    orderBy: { createdAt: "asc" },
    take: maxItems,
    select: {
      id: true,
      userId: true,
      eventType: true,
      activityId: true,
      payload: true,
      attemptCount: true,
      lastAttemptAt: true,
    },
  });

  const result: PushDispatchResult = { ...EMPTY_RESULT };

  for (const item of pending) {
    if (!isRetryDue(item, now)) continue;




    const { dropped } = await partitionRowsByVisibility(
      db,
      { id: item.userId, isSystemAdmin: false },
      [item],
      now,
    );

    if (dropped.length > 0) {
      await db.notificationQueue.update({
        where: { id: item.id },
        data: {
          status: "CANCELLED",
          lastAttemptAt: now,
          lastError: "The recipient can no longer see the related activity.",
        },
      });
      result.cancelled += 1;
      continue;
    }

    const subscriptions = await listSubscriptions(db, item.userId);

    if (subscriptions.length === 0) {


      // Otherwise it would remain in the queue forever.
      await db.notificationQueue.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: now,
          lastError: "The person has no push subscription.",
        },
      });
      result.givenUp += 1;
      continue;
    }

    const row = renderLine(item.eventType, item.payload);
    const message: PushMessage = {
      title: createTranslator(DEFAULT_LOCALE)("notifications.pushTitle"),
      body: row.summary,
      url: `${baseUrl}${row.path}`,
    };

    let deliveredToAnyDevice = false;
    let lastError = "";

    for (const subscription of subscriptions) {
      const outcome = await transport.send(subscription, message, keys);
      result.sent += 1;

      if (outcome.ok) {
        deliveredToAnyDevice = true;
        await db.pushSubscription.updateMany({
          where: { endpoint: subscription.endpoint },
          data: { lastSentAt: now, failureCount: 0 },
        });
        continue;
      }

      if (outcome.gone) {
        // The browser removed the subscription; retrying it would waste every
        // future cycle.
        await dropSubscription(db, subscription.endpoint);
        result.droppedSubscriptions += 1;
        continue;
      }

      lastError = outcome.message;
      await db.pushSubscription.updateMany({
        where: { endpoint: subscription.endpoint },
        data: { failureCount: { increment: 1 } },
      });
    }

    if (deliveredToAnyDevice) {
      // **One device is enough.** Waiting for every device would resend the
      // notification because of one old, inactive phone.
      await db.notificationQueue.update({
        where: { id: item.id },
        data: { status: "SENT", sentAt: now, lastAttemptAt: now, lastError: null },
      });
      result.delivered += 1;
      continue;
    }

    const attemptCount = item.attemptCount + 1;
    const exhausted = isExhausted(attemptCount) || lastError === "";

    await db.notificationQueue.update({
      where: { id: item.id },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        attemptCount,
        lastAttemptAt: now,
        lastError:
          lastError === "" ? "All subscriptions were invalid." : lastError.slice(0, 500),
      },
    });

    if (exhausted) result.givenUp += 1;
    else result.failed += 1;
  }

  return result;
}
