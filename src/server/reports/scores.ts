import type { ReportScope } from "@/server/authz/visibility";

import type { ReportDb } from "./db";
import { dateOnlyString, type ReportPeriodRange } from "./range";
import { rollupByOrgUnit } from "./rollup";
import type { ScoresReport, ScoreSummary } from "./types";
import { compareLocalized } from "@/shared/format/locale";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

interface ScoreRow {
  userId: string;
  periodStart: Date;
  revisionNo: number;
  regularity: number;
  acceptance: number | null;
  approval: number | null;
  followUp: number;
  total: number;
  appreciationPointsPer: number;
}

interface ScoreCounters {
  periods: number;
  people: Set<string>;
  total: number;
  regularity: number;
  regularityCount: number;
  acceptance: number;
  acceptanceCount: number;
  approval: number;
  approvalCount: number;
  followUp: number;
  appreciationCount: number;
  appreciationPoints: number;
}

function emptyScoreCounters(): ScoreCounters {
  return {
    periods: 0,
    people: new Set(),
    total: 0,
    regularity: 0,
    regularityCount: 0,
    acceptance: 0,
    acceptanceCount: 0,
    approval: 0,
    approvalCount: 0,
    followUp: 0,
    appreciationCount: 0,
    appreciationPoints: 0,
  };
}

function addScoreCounters(target: ScoreCounters, source: ScoreCounters): void {
  target.periods += source.periods;
  for (const person of source.people) target.people.add(person);
  target.total += source.total;
  target.regularity += source.regularity;
  target.regularityCount += source.regularityCount;
  target.acceptance += source.acceptance;
  target.acceptanceCount += source.acceptanceCount;
  target.approval += source.approval;
  target.approvalCount += source.approvalCount;
  target.followUp += source.followUp;
  target.appreciationCount += source.appreciationCount;
  target.appreciationPoints += source.appreciationPoints;
}

function average(total: number, count: number): number | null {
  return count === 0 ? null : Math.round((total / count) * 10) / 10;
}

function scoreSummary(counters: ScoreCounters): ScoreSummary {
  return {
    periods: counters.periods,
    people: counters.people.size,
    averageTotal: average(counters.total, counters.periods),
    averageRegularity: average(counters.regularity, counters.periods),
    averageAcceptance: average(counters.acceptance, counters.acceptanceCount),
    averageApproval: average(counters.approval, counters.approvalCount),
    averageFollowUp: average(counters.followUp, counters.periods),
    appreciationCount: counters.appreciationCount,
    appreciationPoints: counters.appreciationPoints,
  };
}

export async function readScoresReport(
  db: ReportDb,
  scope: ReportScope,
  range: ReportPeriodRange,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ScoresReport | null> {
  if (!scope.canViewScoreReports || scope.userIds.length === 0) return null;

  const rows = await db.userScorePeriod.findMany({
    where: {
      userId: { in: scope.userIds },
      frozen: true,
      voided: false,
      periodStart: {
        ...(range.startDate ? { gte: range.startDate } : {}),
        lte: range.endDate,
      },
    },
    select: {
      userId: true,
      periodStart: true,
      revisionNo: true,
      regularity: true,
      acceptance: true,
      approval: true,
      followUp: true,
      total: true,
      appreciationPointsPer: true,
    },
  });

  const latest = new Map<string, ScoreRow>();
  for (const row of rows) {
    const key = `${row.userId}:${dateOnlyString(row.periodStart)}`;
    const previous = latest.get(key);
    if (!previous || previous.revisionNo < row.revisionNo) latest.set(key, row);
  }

  const facts = await db.userScorePeriodFact.findMany({
    where: {
      userId: { in: scope.userIds },
      periodStart: {
        ...(range.startDate ? { gte: range.startDate } : {}),
        lte: range.endDate,
      },
      kind: "APPRECIATION",
    },
    select: { userId: true, periodStart: true, revisionNo: true },
  });
  const factsByPeriod = new Map<string, number>();
  for (const fact of facts) {
    const key = `${fact.userId}:${dateOnlyString(fact.periodStart)}:${fact.revisionNo}`;
    factsByPeriod.set(key, (factsByPeriod.get(key) ?? 0) + 1);
  }

  const personUnits = new Map(
    scope.people.map((person) => [person.id, person.orgUnitId]),
  );
  const all = emptyScoreCounters();
  const direct = new Map<string, ScoreCounters>();

  for (const row of latest.values()) {
    const unitId = personUnits.get(row.userId);
    if (!unitId) continue;
    const appreciationCount =
      factsByPeriod.get(
        `${row.userId}:${dateOnlyString(row.periodStart)}:${row.revisionNo}`,
      ) ?? 0;
    const counters = direct.get(unitId) ?? emptyScoreCounters();
    counters.periods += 1;
    counters.people.add(row.userId);
    counters.total += row.total;
    counters.regularity += row.regularity;
    counters.regularityCount += 1;
    if (row.acceptance !== null) {
      counters.acceptance += row.acceptance;
      counters.acceptanceCount += 1;
    }
    if (row.approval !== null) {
      counters.approval += row.approval;
      counters.approvalCount += 1;
    }
    counters.followUp += row.followUp;
    counters.appreciationCount += appreciationCount;
    counters.appreciationPoints += appreciationCount * row.appreciationPointsPer;
    direct.set(unitId, counters);
    addScoreCounters(all, counters);
  }

  const totals = rollupByOrgUnit(scope.units, scope.rootOrgUnitId, direct, {
    createEmpty: emptyScoreCounters,
    clone: (value) => ({ ...value, people: new Set(value.people) }),
    merge: addScoreCounters,
  });

  return {
    tab: "scores",
    ...scoreSummary(all),
    units: scope.units
      .filter((unit) => (totals.get(unit.id)?.periods ?? 0) > 0)
      .sort((a, b) => a.depth - b.depth || compareLocalized(a.name, b.name, locale))
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        depth: unit.depth,
        ...scoreSummary(totals.get(unit.id)!),
      })),
  };
}
