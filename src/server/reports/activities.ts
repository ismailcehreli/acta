import type { Prisma } from "@prisma/client";

import { listActivitiesByAuthors } from "@/server/authz/activity-repository";
import type { ReportScope } from "@/server/authz/visibility";

import type { ReportDb } from "./db";
import { dateOnlyString, type ReportPeriodRange } from "./range";
import { rollupByOrgUnit } from "./rollup";
import type { ActivityReport } from "./types";
import { compareLocalized } from "@/shared/format/locale";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

interface ActivityCounters {
  total: number;
  approved: number;
  pending: number;
  changesRequested: number;
  rejected: number;
  cancelled: number;
  people: Set<string>;
}

function emptyActivityCounters(): ActivityCounters {
  return {
    total: 0,
    approved: 0,
    pending: 0,
    changesRequested: 0,
    rejected: 0,
    cancelled: 0,
    people: new Set(),
  };
}

function addActivityCounters(
  target: ActivityCounters,
  source: ActivityCounters,
): void {
  target.total += source.total;
  target.approved += source.approved;
  target.pending += source.pending;
  target.changesRequested += source.changesRequested;
  target.rejected += source.rejected;
  target.cancelled += source.cancelled;
  for (const person of source.people) target.people.add(person);
}

function approvalRate(counters: {
  approved: number;
  changesRequested: number;
  rejected: number;
}): number | null {
  const decided =
    counters.approved + counters.changesRequested + counters.rejected;
  return decided === 0 ? null : Math.round((counters.approved / decided) * 100);
}

function activityUnitRows(
  scope: ReportScope,
  direct: Map<string, ActivityCounters>,
  directPeople: Map<string, number>,
  locale: Locale,
): ActivityReport["units"] {
  const totals = rollupByOrgUnit(scope.units, scope.rootOrgUnitId, direct, {
    createEmpty: emptyActivityCounters,
    clone: (value) => ({ ...value, people: new Set(value.people) }),
    merge: addActivityCounters,
  });

  return scope.units
    .filter((unit) => {
      const total = totals.get(unit.id);
      return Boolean(total && (total.people.size > 0 || total.total > 0));
    })
    .sort((a, b) => a.depth - b.depth || compareLocalized(a.name, b.name, locale))
    .map((unit) => {
      const total = totals.get(unit.id) ?? emptyActivityCounters();
      const own = direct.get(unit.id) ?? emptyActivityCounters();
      return {
        id: unit.id,
        name: unit.name,
        depth: unit.depth,
        people: total.people.size,
        directPeople: directPeople.get(unit.id) ?? 0,
        activities: total.total,
        directActivities: own.total,
        approved: total.approved,
        pending: total.pending,
        approvalRate: approvalRate(total),
      };
    });
}

export async function readActivityReport(
  db: ReportDb,
  scope: ReportScope,
  range: ReportPeriodRange,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ActivityReport> {
  const where: Prisma.ActivityWhereInput = {
    authorId: { in: scope.userIds },
    activityDate: {
      ...(range.startDate ? { gte: range.startDate } : {}),
      lte: range.endDate,
    },
  };
  const rows = await listActivitiesByAuthors(db, scope.userIds, {
    where,
    select: {
      authorId: true,
      authorOrgUnitId: true,
      activityDate: true,
      approvalStatus: true,
      approvalSubmittedAt: true,
    },
  });

  const direct = new Map<string, ActivityCounters>();
  const people = new Set<string>();
  const days = new Set<string>();
  let pendingOlderThanSevenDays = 0;

  for (const row of rows) {
    const counters = direct.get(row.authorOrgUnitId) ?? emptyActivityCounters();
    const cancelled = row.approvalStatus === "CANCELLED";
    if (cancelled) {
      counters.cancelled += 1;
    } else {
      counters.total += 1;
      counters.people.add(row.authorId);
      people.add(row.authorId);
      days.add(dateOnlyString(row.activityDate));
    }

    switch (row.approvalStatus) {
      case "APPROVED":
        counters.approved += 1;
        break;
      case "PENDING_APPROVAL":
      case "MANAGER_NOT_FOUND":
        counters.pending += 1;
        if (
          row.approvalSubmittedAt &&
          now.getTime() - row.approvalSubmittedAt.getTime() >=
            7 * 86_400_000
        ) {
          pendingOlderThanSevenDays += 1;
        }
        break;
      case "CHANGES_REQUESTED":
        counters.changesRequested += 1;
        break;
      case "REJECTED":
        counters.rejected += 1;
        break;
      default:
        break;
    }

    direct.set(row.authorOrgUnitId, counters);
  }

  const total = [...direct.values()].reduce((sum, item) => sum + item.total, 0);
  const approved = [...direct.values()].reduce(
    (sum, item) => sum + item.approved,
    0,
  );
  const pending = [...direct.values()].reduce(
    (sum, item) => sum + item.pending,
    0,
  );
  const changesRequested = [...direct.values()].reduce(
    (sum, item) => sum + item.changesRequested,
    0,
  );
  const rejected = [...direct.values()].reduce(
    (sum, item) => sum + item.rejected,
    0,
  );
  const cancelled = [...direct.values()].reduce(
    (sum, item) => sum + item.cancelled,
    0,
  );
  const directPeople = new Map<string, number>();
  for (const person of scope.people) {
    directPeople.set(
      person.orgUnitId,
      (directPeople.get(person.orgUnitId) ?? 0) + 1,
    );
  }

  return {
    tab: "activities",
    total,
    people: people.size,
    activityDays: days.size,
    approved,
    pending,
    changesRequested,
    rejected,
    cancelled,
    approvalRate: approvalRate({ approved, changesRequested, rejected }),
    pendingOlderThanSevenDays,
    units: activityUnitRows(scope, direct, directPeople, locale),
  };
}
