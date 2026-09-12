import type { Prisma, PrismaClient } from "@prisma/client";

import {
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { visibleActivityWhere, type VisibilityDb } from "@/server/authz/visibility";

import { renderLine } from "./templates";
import { formatInstantShort } from "@/shared/format/date-time";
import { createTranslator, DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

// In-app notification inbox (Task 10.4).
//
// Source is not a new table: the notification queue records what was notified.
// Uses EMAIL channel as canonical record because EMAIL is written unconditionally.
// Seen status is independent of email delivery.

export type InboxDb = Pick<PrismaClient, "notificationQueue"> &
  ActivityRepositoryDb & VisibilityDb;

/**
 * Visibility scope for inbox (audit 21.08.2026, finding 3).
 *
 * Checks activity visibility at read time so transferred/unauthorized users
 * do not see titles or numbers of activities they can no longer view.
 */
async function inboxScope(
  db: InboxDb,
  userId: string,
  now: Date,
): Promise<Prisma.NotificationQueueWhereInput> {
  const visibleWhere = await visibleActivityWhere(
    db,
    { id: userId, isSystemAdmin: false },
    undefined,
    now,
  );

  return {
    userId,
    channel: "EMAIL",
    OR: [{ activityId: null }, { activity: { is: visibleWhere } }],
  };
}

export const INBOX_LIMIT = 15;

export interface InboxItem {
  id: string;
  eventType: string;
  summary: string;
  activityNo: number | null;
  path: string;
  createdAt: Date;
  age: string;
  seen: boolean;
}

function getActivityIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const value = (payload as { activityId?: unknown }).activityId;
  return typeof value === "string" ? value : null;
}

export function relativeTime(
  when: Date,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const t = createTranslator(locale);
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);

  if (minutes < 1) return t("notifications.relativeTime.justNow");
  if (minutes < 60) return t("notifications.relativeTime.minutes", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("notifications.relativeTime.hours", { count: hours });

  return formatInstantShort(when, locale);
}

export async function listInbox(
  db: InboxDb,
  userId: string,
  limit = INBOX_LIMIT,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): Promise<InboxItem[]> {
  const rows = await db.notificationQueue.findMany({
    where: await inboxScope(db, userId, now),
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      payload: true,
      createdAt: true,
      seenAt: true,
    },
  });

  const activityIds = [
    ...new Set(
      rows
        .map((row) => getActivityIdFromPayload(row.payload))
        .filter((id): id is string => id !== null),
    ),
  ];

  const activityNoMap = new Map<string, number>();
  if (activityIds.length > 0) {
    const visibleActivities = await listVisibleActivities(db, {
      id: userId,
      isSystemAdmin: false,
    }, {
      where: { id: { in: activityIds } },
      select: { id: true, activityNo: true },
    }, undefined, now);
    for (const act of visibleActivities) activityNoMap.set(act.id, act.activityNo);
  }

  return rows.map((row) => {
    const rendered = renderLine(row.eventType, row.payload, locale);
    const activityId = getActivityIdFromPayload(row.payload);

    return {
      id: row.id,
      eventType: row.eventType,
      summary: rendered.summary,
      activityNo: activityId ? (activityNoMap.get(activityId) ?? null) : null,
      path: rendered.path,
      createdAt: row.createdAt,
      age: relativeTime(row.createdAt, now, locale),
      seen: row.seenAt !== null,
    };
  });
}

export async function countUnseen(
  db: InboxDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return db.notificationQueue.count({
    where: { ...(await inboxScope(db, userId, now)), seenAt: null },
  });
}

export async function markInboxSeen(
  db: InboxDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await db.notificationQueue.updateMany({
    where: { userId, channel: "EMAIL", seenAt: null },
    data: { seenAt: now },
  });

  return result.count;
}
