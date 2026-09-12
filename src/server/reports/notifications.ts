import type { ReportScope } from "@/server/authz/visibility";
import {
  isKnownEvent,
} from "@/server/notifications/events";
import { companyDayStart } from "@/shared/format/date-time";

import type { ReportDb } from "./db";
import type { ReportPeriodRange } from "./range";
import { rollupByOrgUnit } from "./rollup";
import type { NotificationsReport } from "./types";
import { compareLocalized } from "@/shared/format/locale";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

interface NotificationCounters {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  cancelled: number;
}

function emptyNotificationCounters(): NotificationCounters {
  return { total: 0, pending: 0, sent: 0, failed: 0, cancelled: 0 };
}

function addNotificationCounters(
  target: NotificationCounters,
  source: NotificationCounters,
): void {
  target.total += source.total;
  target.pending += source.pending;
  target.sent += source.sent;
  target.failed += source.failed;
  target.cancelled += source.cancelled;
}

function notificationUnitRows(
  scope: ReportScope,
  direct: Map<string, NotificationCounters>,
  locale: Locale,
): NotificationsReport["units"] {
  const totals = rollupByOrgUnit(scope.units, scope.rootOrgUnitId, direct, {
    createEmpty: emptyNotificationCounters,
    clone: (value) => ({ ...value }),
    merge: addNotificationCounters,
  });

  return scope.units
    .filter((unit) => (totals.get(unit.id)?.total ?? 0) > 0)
    .sort((a, b) => a.depth - b.depth || compareLocalized(a.name, b.name, locale))
    .map((unit) => {
      const total = totals.get(unit.id) ?? emptyNotificationCounters();
      return { id: unit.id, name: unit.name, depth: unit.depth, ...total };
    });
}

export async function readNotificationsReport(
  db: ReportDb,
  scope: ReportScope,
  range: ReportPeriodRange,
  locale: Locale = DEFAULT_LOCALE,
): Promise<NotificationsReport> {
  const rows = await db.notificationQueue.findMany({
    where: {
      userId: { in: scope.userIds },
      createdAt: {
        ...(range.startDate
          ? { gte: companyDayStart(range.startDay as string) }
          : {}),
        lt: range.endExclusive,
      },
    },
    select: { userId: true, eventType: true, channel: true, status: true },
  });
  const personUnits = new Map(
    scope.people.map((person) => [person.id, person.orgUnitId]),
  );
  const direct = new Map<string, NotificationCounters>();
  const eventCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();

  for (const row of rows) {
    const unitId = personUnits.get(row.userId);
    if (!unitId) continue;
    const counters = direct.get(unitId) ?? emptyNotificationCounters();
    counters.total += 1;
    if (row.status === "PENDING") counters.pending += 1;
    if (row.status === "SENT") counters.sent += 1;
    if (row.status === "FAILED") counters.failed += 1;
    if (row.status === "CANCELLED") counters.cancelled += 1;
    direct.set(unitId, counters);
    eventCounts.set(row.eventType, (eventCounts.get(row.eventType) ?? 0) + 1);
    channelCounts.set(row.channel, (channelCounts.get(row.channel) ?? 0) + 1);
  }

  const total = [...direct.values()].reduce((sum, item) => sum + item.total, 0);
  const pending = [...direct.values()].reduce((sum, item) => sum + item.pending, 0);
  const sent = [...direct.values()].reduce((sum, item) => sum + item.sent, 0);
  const failed = [...direct.values()].reduce((sum, item) => sum + item.failed, 0);
  const cancelled = [...direct.values()].reduce(
    (sum, item) => sum + item.cancelled,
    0,
  );
  const attempted = sent + failed;

  return {
    tab: "notifications",
    total,
    pending,
    sent,
    failed,
    cancelled,
    successRate: attempted === 0 ? null : Math.round((sent / attempted) * 100),
    byChannel: [...channelCounts.entries()]
      .map(([channel, count]) => ({
        key: channel,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    byEvent: [...eventCounts.entries()]
      .map(([eventType, count]) => ({
        key: isKnownEvent(eventType) ? eventType : "other",
        count,
      }))
      .sort((a, b) => b.count - a.count),
    units: notificationUnitRows(scope, direct, locale),
  };
}
