import type { ReportScope } from "@/server/authz/visibility";

import type { ReportDb } from "./db";
import {
  dateDistance,
  dateOnlyString,
  maxDay,
  minDay,
  type ReportPeriodRange,
} from "./range";
import { rollupByOrgUnit } from "./rollup";
import type { AbsenceReport } from "./types";
import { compareLocalized } from "@/shared/format/locale";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

interface AbsenceCounters {
  periods: number;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  approvedDays: number;
  pendingDays: number;
  people: Set<string>;
}

function emptyAbsenceCounters(): AbsenceCounters {
  return {
    periods: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    cancelled: 0,
    approvedDays: 0,
    pendingDays: 0,
    people: new Set(),
  };
}

function addAbsenceCounters(
  target: AbsenceCounters,
  source: AbsenceCounters,
): void {
  target.periods += source.periods;
  target.approved += source.approved;
  target.pending += source.pending;
  target.rejected += source.rejected;
  target.cancelled += source.cancelled;
  target.approvedDays += source.approvedDays;
  target.pendingDays += source.pendingDays;
  for (const person of source.people) target.people.add(person);
}

function absenceUnitRows(
  scope: ReportScope,
  direct: Map<string, AbsenceCounters>,
  locale: Locale,
): AbsenceReport["units"] {
  const totals = rollupByOrgUnit(scope.units, scope.rootOrgUnitId, direct, {
    createEmpty: emptyAbsenceCounters,
    clone: (value) => ({ ...value, people: new Set(value.people) }),
    merge: addAbsenceCounters,
  });

  return scope.units
    .filter((unit) => (totals.get(unit.id)?.people.size ?? 0) > 0)
    .sort((a, b) => a.depth - b.depth || compareLocalized(a.name, b.name, locale))
    .map((unit) => {
      const total = totals.get(unit.id) ?? emptyAbsenceCounters();
      return {
        id: unit.id,
        name: unit.name,
        depth: unit.depth,
        people: total.people.size,
        periods: total.periods,
        approvedDays: total.approvedDays,
        pending: total.pending,
        approved: total.approved,
      };
    });
}

export async function readAbsenceReport(
  db: ReportDb,
  scope: ReportScope,
  range: ReportPeriodRange,
  locale: Locale = DEFAULT_LOCALE,
): Promise<AbsenceReport> {
  const rows = await db.noActivityPeriod.findMany({
    where: {
      userId: { in: scope.userIds },
      startDate: { lte: range.endDate },
      ...(range.startDate ? { endDate: { gte: range.startDate } } : {}),
    },
    select: {
      userId: true,
      startDate: true,
      endDate: true,
      status: true,
      cancelledAt: true,
    },
  });
  const personUnits = new Map(
    scope.people.map((person) => [person.id, person.orgUnitId]),
  );
  const direct = new Map<string, AbsenceCounters>();

  for (const row of rows) {
    const unitId = personUnits.get(row.userId);
    if (!unitId) continue;
    const counters = direct.get(unitId) ?? emptyAbsenceCounters();
    const rowStart = dateOnlyString(row.startDate);
    const rowEnd = dateOnlyString(row.endDate);
    const overlapStart = range.startDay ? maxDay(rowStart, range.startDay) : rowStart;
    const overlapEnd = minDay(rowEnd, range.endDay);
    if (overlapStart > overlapEnd) continue;
    const days = dateDistance(overlapStart, overlapEnd) + 1;
    counters.people.add(row.userId);

    if (row.cancelledAt) {
      counters.cancelled += 1;
    } else {
      counters.periods += 1;
      if (row.status === "APPROVED") {
        counters.approved += 1;
        counters.approvedDays += days;
      } else if (row.status === "PENDING") {
        counters.pending += 1;
        counters.pendingDays += days;
      } else {
        counters.rejected += 1;
      }
    }
    direct.set(unitId, counters);
  }

  const all = [...direct.values()];
  return {
    tab: "absence",
    periods: all.reduce((sum, item) => sum + item.periods, 0),
    people: new Set(all.flatMap((item) => [...item.people])).size,
    approved: all.reduce((sum, item) => sum + item.approved, 0),
    pending: all.reduce((sum, item) => sum + item.pending, 0),
    rejected: all.reduce((sum, item) => sum + item.rejected, 0),
    cancelled: all.reduce((sum, item) => sum + item.cancelled, 0),
    approvedDays: all.reduce((sum, item) => sum + item.approvedDays, 0),
    pendingDays: all.reduce((sum, item) => sum + item.pendingDays, 0),
    units: absenceUnitRows(scope, direct, locale),
  };
}
