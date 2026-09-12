import type { PrismaClient } from "@prisma/client";

import {
  isActionRequiredEvent,
  isUrgentEvent,
} from "@/server/notifications/events";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { renderEmail, renderLine } from "@/server/notifications/templates";
import {
  partitionRowsByVisibility,
  type VisibleRowsDb,
} from "@/server/notifications/visible-rows";
import {
  isDigestDue,
  isExhausted,
  isRetryDue,
  MAX_ATTEMPTS,
} from "@/server/notifications/schedule";

import type { EmailTransport } from "./transport";

// Queue dispatcher (§12.3). Called periodically by the worker process.
//
// Sequence: collect pending rows by user -> select those due for sending ->
// coalesce into single email and send -> update results.
//
// No separate coalescing window is needed: the worker cycle itself forms the window.
// Notifications accumulated for the same user within a cycle are sent in one email.

export type DispatcherDb = Pick<
  PrismaClient,
  "notificationQueue" | "user" | "systemSetting"
> &
  VisibleRowsDb;

export interface DispatchResult {
  /** Number of sent emails (one email per recipient). */
  sent: number;
  /** Number of queue items marked as delivered. */
  delivered: number;
  /** Number of queue items that failed in this cycle. */
  failed: number;
  /** Number of items given up after exceeding retry limits. */
  givenUp: number;
  /** Number of items cancelled because recipient can no longer view the activity. */
  cancelled: number;
}

export interface DispatchOptions {
  now: Date;
  baseUrl: string;
  /** Max recipients to process in one cycle to keep execution time bounded. */
  maxRecipients?: number;
}

export async function dispatchNotifications(
  db: DispatcherDb,
  transport: EmailTransport,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { now, baseUrl, maxRecipients = 100 } = options;

  const pending = await db.notificationQueue.findMany({
    where: { status: "PENDING", channel: "EMAIL" },
    orderBy: { createdAt: "asc" },
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

  const result: DispatchResult = {
    sent: 0,
    delivered: 0,
    failed: 0,
    givenUp: 0,
    cancelled: 0,
  };
  if (pending.length === 0) return result;

  // Digest hour is configurable via settings (§16.5).
  const digestHour = await readNumericSetting(db, SETTING_KEYS.dailyDigestHour);

  // Group by user for coalescing
  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let processedUsers = 0;

  for (const [userId, queueRows] of byUser) {
    let rows = queueRows;
    if (processedUsers >= maxRecipients) break;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true, notificationMode: true },
    });

    // Inactive users do not receive emails; do not leave pending.
    if (!user || !user.isActive) {
      await db.notificationQueue.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          status: "FAILED",
          lastError: "Recipient is inactive or not found.",
          lastAttemptAt: now,
        },
      });
      result.givenUp += rows.length;
      continue;
    }

    // Visibility is re-checked at dispatch time (audit 21.08.2026, finding 3).
    const { passed, dropped } = await partitionRowsByVisibility(
      db,
      { id: userId, isSystemAdmin: false },
      rows,
      now,
    );

    if (dropped.length > 0) {
      await db.notificationQueue.updateMany({
        where: { id: { in: dropped.map((row) => row.id) } },
        data: {
          status: "CANCELLED",
          lastAttemptAt: now,
          lastError: "Recipient can no longer view the activity.",
        },
      });
      result.cancelled += dropped.length;
    }

    if (passed.length === 0) continue;
    rows = passed;

    // Conclude exhausted attempts
    const exhausted = rows.filter((row) => isExhausted(row.attemptCount));
    if (exhausted.length > 0) {
      await db.notificationQueue.updateMany({
        where: { id: { in: exhausted.map((r) => r.id) } },
        data: { status: "FAILED", lastAttemptAt: now },
      });
      result.givenUp += exhausted.length;
    }

    const ready = rows.filter(
      (row) => !isExhausted(row.attemptCount) && isRetryDue(row, now),
    );
    if (ready.length === 0) continue;

    // Urgent events (e.g. password reset) are dispatched immediately without digest delay
    const urgent = ready.filter((row) => isUrgentEvent(row.eventType));
    const normal = ready.filter((row) => !isUrgentEvent(row.eventType));

    const groups: { rows: typeof ready; digest: boolean }[] = urgent.map((row) => ({
      rows: [row],
      digest: false,
    }));

    // "Action required only" preference (Task 10.8): informational items are filtered out
    const filteredOut =
      user.notificationMode === "ACTION_ONLY"
        ? normal.filter((row) => !isActionRequiredEvent(row.eventType))
        : [];

    if (filteredOut.length > 0) {
      await db.notificationQueue.updateMany({
        where: { id: { in: filteredOut.map((row) => row.id) } },
        data: {
          status: "SENT",
          sentAt: now,
          lastAttemptAt: now,
          lastError: "User preference: action-required notifications only.",
        },
      });
    }

    const toSend = normal.filter((row) => !filteredOut.includes(row));

    if (toSend.length > 0) {
      if (user.notificationMode === "DAILY_DIGEST") {
        const lastSent = await db.notificationQueue.findFirst({
          where: { userId, status: "SENT" },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        });

        if (isDigestDue(now, lastSent?.sentAt ?? null, digestHour)) {
          groups.push({ rows: toSend, digest: true });
        }
      } else {
        groups.push({ rows: toSend, digest: false });
      }
    }

    if (groups.length === 0) continue;
    processedUsers += 1;

    for (const group of groups) {
      await sendGroup(group.rows, group.digest);
    }
  }

  return result;

  async function sendGroup(batch: typeof pending, digest: boolean): Promise<void> {
    const recipient = await db.user.findUnique({
      where: { id: batch[0].userId },
      select: { email: true },
    });
    if (!recipient) return;

    const lines = batch.map((row) => renderLine(row.eventType, row.payload));
    const email = renderEmail(lines, { baseUrl, digest });

    try {
      await transport.send({ to: recipient.email, ...email });

      await db.notificationQueue.updateMany({
        where: { id: { in: batch.map((r) => r.id) } },
        data: {
          status: "SENT",
          sentAt: now,
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });

      result.sent += 1;
      result.delivered += batch.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await db.notificationQueue.updateMany({
        where: { id: { in: batch.map((r) => r.id) } },
        data: {
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          lastError: message.slice(0, 1_000),
        },
      });

      result.failed += batch.length;
    }
  }
}

export { MAX_ATTEMPTS };
