import type { PrismaClient } from "@prisma/client";

import {
  subordinateUserIds,
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import {
  SETTING_KEYS,
  readBooleanSetting,
  readNumericSetting,
} from "@/server/settings/system-settings";
import { companyDay } from "@/shared/format/date-time";

import {
  collectScoreInput,
  collectScoreInputs,
  loadScoreContext,
  type ScoreCollectDb,
} from "./collect";
import {
  computeScore,
  profileWeights,
  resolveScoreProfile,
  SCORE_CALCULATORS,
  type ScoreInput,
  type ScoreProfile,
  type ScoreResult,
  type ScoreWeights,
} from "./compute";
import { readScoreWeights } from "./weights";


//



//

//










//






export type ScoreReadDb = ScoreCollectDb &
  VisibilityDb &
  Pick<
    PrismaClient,
    "systemSetting" | "userScorePeriod" | "userScorePeriodFact" | "$queryRaw"
  >;

export interface UserScore extends ScoreResult {
  userId: string;
  periodStart: string;
  expectedDays: number;
  writtenDays: number;
  writtenCount: number;
  approvedCount: number;
  decidedCount: number;
  decidedOnTimeCount: number;
  followUpTotal: number;
  followUpHandled: number;
  profile: ScoreProfile;

  weights: ScoreWeights;

  baseTotal: number;

  appreciationCount: number;

  appreciationPoints: number;

  appreciationPointsPer: number;
}

function scoreDetails(
  score: ScoreResult,
  input: ScoreInput,
): Pick<
  UserScore,
  "baseTotal" | "appreciationCount" | "appreciationPoints" | "appreciationPointsPer"
> {
  const appreciationCount = Math.max(
    0,
    Math.trunc(input.appreciationCount ?? score.appreciationCount ?? 0),
  );
  const appreciationPointsPer = Math.max(
    0,
    Math.trunc(input.appreciationPointsPer ?? score.appreciationPointsPer ?? 0),
  );
  const appreciationPoints =
    score.appreciationPoints ?? appreciationCount * appreciationPointsPer;

  return {
    baseTotal: score.baseTotal ?? score.total - appreciationPoints,
    appreciationCount,
    appreciationPoints,
    appreciationPointsPer,
  };
}


export function livePeriodBounds(now: Date): { from: Date; to: Date } {
  const { from, to } = periodBounds(now);
  const today = new Date(`${companyDay(now)}T00:00:00.000Z`);

  return { from, to: today < to ? today : to };
}

/**
 * First and last date of the period.
 *
 * **The period is monthly and is not a setting** (product decision,
 * 23.08.2026; open question 20, design "Settings"). Making its length
 * configurable would not be a simple panel field: closed `UserScorePeriod`
 * rows retain their original length, while the closure worker's "next month"
 * semantics and decline threshold would change together.
 */
export function periodBounds(now: Date): { from: Date; to: Date } {
  const day = companyDay(now);
  const [year, month] = day.split("-").map(Number);

  return {
    from: new Date(Date.UTC(year as number, (month as number) - 1, 1)),
    to: new Date(Date.UTC(year as number, month as number, 0)),
  };
}

/** Whether this person is scored: setting enabled, `isScored`, and `writesActivities`. */
async function isScored(db: ScoreReadDb, userId: string): Promise<boolean> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.scoringEnabled)))
    return false;

  const person = await db.user.findUnique({
    where: { id: userId },
    select: { isScored: true, writesActivities: true, isActive: true },
  });

  return Boolean(person?.isActive && person.isScored && person.writesActivities);
}

/** Whether the viewer can see the target's score. */
async function canViewScore(
  db: ScoreReadDb,
  viewer: Viewer,
  targetId: string,
): Promise<boolean> {
  if (viewer.id === targetId) return true;

  const subordinates = await subordinateUserIds(db, viewer.id);
  return subordinates.includes(targetId);
}

export async function readUserScore(
  db: ScoreReadDb,
  viewer: Viewer,
  userId: string,
  now: Date,
): Promise<UserScore | null> {
  if (!(await canViewScore(db, viewer, userId))) return null;
  if (!(await isScored(db, userId))) return null;

  const { from, to } = livePeriodBounds(now);

  const [person, input, weights] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        isUnitManager: true,
        orgUnit: { select: { requiresApproval: true } },
      },
    }),
    // In a live period the upper bound for timestamped events is **now**, so
    // decisions and answers from today are visible (P3-3).
    collectScoreInput(db, viewer, userId, from, to, now),
    readScoreWeights(db),
  ]);

  if (!person) return null;

  const profile = resolveScoreProfile({
    isUnitManager: person.isUnitManager,
    requiresApproval: person.orgUnit.requiresApproval,
  });

  const result = computeScore(profile, input, weights);
  const details = scoreDetails(result, input);

  return {
    userId,
    periodStart: from.toISOString().slice(0, 10),
    expectedDays: input.expectedDays,
    writtenDays: input.writtenDays,
    writtenCount: input.writtenCount,
    approvedCount: input.approvedCount,
    decidedCount: input.decidedCount,
    decidedOnTimeCount: input.decidedOnTimeCount,
    followUpTotal: input.followUpTotal,
    followUpHandled: input.followUpHandled,
    profile,
    weights: profileWeights(profile, weights),
    ...result,
    ...details,
  };
}

/** Scores for the manager's team; nobody outside the scope is listed. */
export async function readTeamScores(
  db: ScoreReadDb,
  viewer: Viewer,
  now: Date,
): Promise<(UserScore & { fullName: string })[]> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.scoringEnabled))) return [];

  const subordinateIds = await subordinateUserIds(db, viewer.id);
  if (subordinateIds.length === 0) return [];

  const people = await db.user.findMany({
    where: {
      id: { in: subordinateIds },
      isActive: true,
      isScored: true,
      writesActivities: true,
    },
    select: {
      id: true,
      fullName: true,
      isUnitManager: true,
      orgUnit: { select: { requiresApproval: true } },
    },
    // Default ordering is **alphabetical**, not by score: it explains what
    // the screen contains instead of turning the list into a competition.
    orderBy: { fullName: "asc" },
  });

  if (people.length === 0) return [];

  // **There is no calculation per person** (audit finding 9, 23.08.2026).
  //
  // The previous implementation called `readUserScore` for every person;
  // each call queried calendars, absences, activities, decisions, and items.
  // Measurements were 985 queries for 20 people and 1,955 for 40: fully
  // linear. The design explicitly forbids 40 live calculations for a team.
  //
  // Visibility is unchanged: the viewer's scope is resolved once and the
  // same predicate is applied to every person.
  const { from, to } = livePeriodBounds(now);

  const [ctx, weights] = await Promise.all([
    loadScoreContext(db, viewer),
    readScoreWeights(db),
  ]);

  const inputs = await collectScoreInputs(
    db,
    ctx,
    people.map((person) => person.id),
    from,
    to,
    // In a live period the upper bound for timestamped events is **now**, so
    // decisions and answers from today are visible (P3-3).
    now,
  );

  const periodStart = from.toISOString().slice(0, 10);

  return people.flatMap((person) => {
    const input = inputs.get(person.id);
    if (!input) return [];

    const profile = resolveScoreProfile({
      isUnitManager: person.isUnitManager,
      requiresApproval: person.orgUnit.requiresApproval,
    });
    const result = computeScore(profile, input, weights);
    const details = scoreDetails(result, input);

    return [
      {
        userId: person.id,
        fullName: person.fullName,
        periodStart,
        expectedDays: input.expectedDays,
        writtenDays: input.writtenDays,
        writtenCount: input.writtenCount,
        approvedCount: input.approvedCount,
        decidedCount: input.decidedCount,
        decidedOnTimeCount: input.decidedOnTimeCount,
        followUpTotal: input.followUpTotal,
        followUpHandled: input.followUpHandled,
        profile,
        weights: profileWeights(profile, weights),
        ...result,
        ...details,
      },
    ];
  });
}

/** Decline threshold, exposed so the UI can describe it. */
export async function readDeclineThreshold(db: ScoreReadDb): Promise<number> {
  return readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods);
}

/** Number of periods shown in the chart; calculation may look deeper. */
const GRAPH_PERIODS = 6;

export interface ScoreTrend {
  /** Newest to oldest, up to six periods. */
  periods: { periodStart: string; total: number }[];
  /**
   * Whether the score declines for the configured number of **consecutive** periods.
   *
   * The most useful purpose of a score is detecting decline, not ranking:
   * "ranked seventh" says little, while "declining for three periods" does.
   */
  declining: boolean;
}

/** How many periods to inspect; calculation may look deeper than the chart. */
async function periodDepth(db: ScoreReadDb): Promise<number> {
  const threshold = await readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods);
  return Math.max(GRAPH_PERIODS, threshold);
}

/** Period row returned by the window query. */
interface PeriodRow {
  userId: string;
  periodStart: Date;
  revisionNo: number;
  total: number;
  expectedDays: number;
  formulaVersion: number | null;
  profile: string | null;
  weightRegularity: number | null;
  weightAcceptance: number | null;
  weightApproval: number | null;
  weightFollowUp: number | null;
  appreciationPointsPer: number | null;
}

/** Builds a period input from fact rows. */
function buildScoreInput(
  row: {
    expectedDays: number;
    formulaVersion: number | null;
    profile: string | null;
    weightRegularity: number | null;
    weightAcceptance: number | null;
    weightApproval: number | null;
    weightFollowUp: number | null;
    appreciationPointsPer: number | null;
  },
  facts: { kind: string; happenedOn: Date; onTime: boolean }[],
): {
  calculate: (typeof SCORE_CALCULATORS)[number];
  profile: ScoreProfile;
  weights: ScoreWeights;
  input: ScoreInput;
} | null {
  // **The formula version comes from the period itself** (P8-5). Unknown
  // versions are not read; falling back to today's algorithm would silently
  // reinterpret history.
  const calculate =
    row.formulaVersion === null
      ? undefined
      : SCORE_CALCULATORS[row.formulaVersion];
  if (!calculate) return null;

  if (
    row.profile === null ||
    row.weightRegularity === null ||
    row.weightAcceptance === null ||
    row.weightApproval === null ||
    row.weightFollowUp === null
  ) {
    return null;
  }

  const writtenFacts = facts.filter((fact) => fact.kind === "WRITTEN");
  const decisionFacts = facts.filter((fact) => fact.kind === "DECISION");
  const obligationFacts = facts.filter((fact) => fact.kind === "OBLIGATION");

  return {
    calculate,
    profile: row.profile as ScoreProfile,
    weights: {
      regularity: row.weightRegularity,
      acceptance: row.weightAcceptance,
      approval: row.weightApproval,
      followUp: row.weightFollowUp,
    },
    input: {
      // **The denominator is frozen at period end**: a later cancellation or
      // added holiday cannot change a closed period.
      expectedDays: row.expectedDays,
      writtenDays: new Set(
        writtenFacts
          .filter((o) => o.onTime)
          .map((o) => o.happenedOn.toISOString().slice(0, 10)),
      ).size,
      writtenCount: writtenFacts.length,
      approvedCount: facts.filter((fact) => fact.kind === "ACCEPTED").length,
      decidedCount: decisionFacts.length,
      decidedOnTimeCount: decisionFacts.filter((fact) => fact.onTime).length,
      followUpTotal: obligationFacts.length,
      followUpHandled: obligationFacts.filter((fact) => fact.onTime).length,
      appreciationCount: facts.filter((fact) => fact.kind === "APPRECIATION").length,
      appreciationPointsPer: row.appreciationPointsPer ?? 0,
    },
  };
}

/**
 * Trends for multiple people with a query count **independent of people**.
 *
 * Two findings are addressed together (product decision, 24.08.2026):
 *
 * **P3-R2-4 (freezing).** A closed period used to be recalculated from live
 * tables when someone viewed it, using **today's** data: a September approval
 * changed August acceptance, a later leave cancellation grew the denominator,
 * and a weight setting rewrote all history. Periods now freeze at closure;
 * reads apply only **visibility**. Visibility still comes from today—an
 * administrator who later joins a branch can see its history (§4.6)—but what
 * happened *during that period* comes from period end.
 *
 * **Finding 9 (N+1).** Trends were read per person with a multi-table
 * calculation for every period: six calculations per person for a six-period
 * chart. All people and periods are now read in two queries.
 *
 * **Old periods remain hidden.** Rows without facts (`frozen = false`) are not
 * shown on any screen (product decision, 25.08.2026). The row is not deleted
 * physically (§16.6); it is simply not read.
 */
export async function readScoreTrends(
  db: ScoreReadDb,
  viewer: Viewer,
  userIds: string[],
): Promise<Map<string, ScoreTrend>> {
  const result = new Map<string, ScoreTrend>();
  if (userIds.length === 0) return result;

  // **Authorize the target list here** (audit 25.08.2026, P8-1).
  //
  // The caller's list used to enter the query unchanged. Filtering facts with
  // `visibleActivityWhere` is **not access control for the target**: even for
  // an out-of-scope person, the period count, frozen denominator, and profile
  // total exposed derived history about work and leave.
  //
  // "The caller already supplied a scoped list" is not sufficient: security
  // must hold at the service boundary, not depend on caller ordering (§18.4).
  const subordinateIds = await subordinateUserIds(db, viewer.id);
  const inScope = new Set([viewer.id, ...subordinateIds]);
  const authorizedUserIds = userIds.filter((id) => inScope.has(id));
  if (authorizedUserIds.length === 0) return result;

  const [threshold, depth] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.scoringDeclinePeriods),
    periodDepth(db),
  ]);

  // **Read only the periods required** (audit 25.08.2026, P8-8).
  //
  // The old query fetched all frozen periods and sliced them in memory. Query
  // count stayed constant, but transferred history grew linearly: one person
  // with 60 periods sent 60 periods and 1,200 fact rows, although the screen
  // needs only the newest `max(6, threshold)` periods.
  //
  // The window function ranks periods per person **in the database**.
  const rows = await db.$queryRaw<PeriodRow[]>`
    WITH latest_revision_per_period AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY "userId", "periodStart"
               ORDER BY "revisionNo" DESC
               ) AS version_rank
        FROM "UserScorePeriod"
       WHERE "userId" = ANY(${authorizedUserIds}) AND "frozen"
    ), latest_periods AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY "userId" ORDER BY "periodStart" DESC
             ) AS period_rank
        FROM latest_revision_per_period
       -- Select the newest revision first, then exclude voided revisions.
       -- Reversing this order could expose an old, invalid revision.
       WHERE version_rank = 1 AND NOT "voided"
    )
    SELECT "userId", "periodStart", "revisionNo", "total", "expectedDays", "formulaVersion",
           "profile", "weightRegularity", "weightAcceptance",
           "weightApproval", "weightFollowUp", "appreciationPointsPer"
      FROM latest_periods
     WHERE period_rank <= ${depth}
     ORDER BY "userId", "periodStart" DESC
  `;

  const personRows = new Map<string, PeriodRow[]>();
  for (const row of rows) {
    const existingRows = personRows.get(row.userId) ?? [];
    existingRows.push(row);
    personRows.set(row.userId, existingRows);
  }

  // **The person's own row is not recalculated**: it was written with that
  // person's scope, and recalculation after closure would silently change
  // history.
  // **Fact queries are tied to person-period pairs** (audit P8-R2-5,
  // 25.08.2026).
  //
  // The old query used the **union of dates**: old periods cut from one
  // person's chart were queried again when they matched another person's
  // selected dates. An asymmetric two-person example transferred 180 rows
  // when only 120 were needed.
  const personPeriodPairs = rows
    .filter((row) => row.userId !== viewer.id)
    .map((row) => ({
      userId: row.userId,
      periodStart: row.periodStart,
      revisionNo: row.revisionNo,
    }));

  const facts =
    personPeriodPairs.length === 0
      ? []
      : await db.userScorePeriodFact.findMany({
          where: {
            // Only selected **person-period** pairs; fetching all historical
            // facts made row count grow with history (P8-8).
            OR: personPeriodPairs,
            // Visibility filters through the fact's activity: records the
            // viewer cannot see never enter the calculation (§18.4).
            activity: await visibleActivityWhere(db, viewer),
          },
          select: {
            userId: true,
            periodStart: true,
            revisionNo: true,
            kind: true,
            happenedOn: true,
            onTime: true,
          },
        });

  const factsByKey = new Map<string, typeof facts>();
  for (const fact of facts) {
    const key = `${fact.userId}|${fact.periodStart.toISOString().slice(0, 10)}|${fact.revisionNo}`;
    const existingFacts = factsByKey.get(key) ?? [];
    existingFacts.push(fact);
    factsByKey.set(key, existingFacts);
  }

  for (const userId of authorizedUserIds) {
    const own = userId === viewer.id;
    const personRow = personRows.get(userId) ?? [];

    const totals = personRow.flatMap((row) => {
      const day = row.periodStart.toISOString().slice(0, 10);

      // **Unknown formula versions are hidden from their owner too** (audit
      // P8-R2-4, 25.08.2026). Returning the stored total only to the owner
      // meant two viewers could see different values for the same period.
      if (row.formulaVersion === null || !SCORE_CALCULATORS[row.formulaVersion]) {
        return [];
      }

      if (own) return [{ periodStart: day, total: row.total }];

      const calculation = buildScoreInput(
        row,
        factsByKey.get(`${userId}|${day}|${row.revisionNo}`) ?? [],
      );
      // A row without its formula cannot be read; falling back to today's
      // setting would recreate the historical bug being prevented.
      if (!calculation) return [];

      return [
        {
          periodStart: day,
          total: calculation.calculate(
            calculation.profile,
            calculation.input,
            calculation.weights,
          ).total,
        },
      ];
    });

    result.set(userId, {
      periods: totals.slice(0, GRAPH_PERIODS),
      declining: hasDecline(totals, threshold),
    });
  }

  return result;
}

/** Whether the score has declined for the configured number of periods. */
function hasDecline(totals: { total: number }[], threshold: number): boolean {
  // Each next period must be lower; one increase breaks the consecutive run.
  let consecutiveDeclines = 0;
  for (let i = 0; i + 1 < totals.length; i += 1) {
    const next = totals[i]?.total ?? 0;
    const old = totals[i + 1]?.total ?? 0;
    if (next < old) consecutiveDeclines += 1;
    else break;
  }

  // **The threshold is a period count, not a transition count** (audit
  // 23.08.2026, finding 7). The three-period sequence `91 → 78 → 64` has
  // two transitions and is the design's example of a three-period decline.
  return consecutiveDeclines >= Math.max(1, threshold - 1);
}

/** Returns a person's recent periods and decline flag; out-of-scope is empty. */
export async function readScoreTrend(
  db: ScoreReadDb,
  viewer: Viewer,
  userId: string,
): Promise<ScoreTrend> {
  // A trend is also a read path: out-of-scope history must remain hidden.
  if (!(await canViewScore(db, viewer, userId))) {
    return { periods: [], declining: false };
  }

  const trends = await readScoreTrends(db, viewer, [userId]);
  return trends.get(userId) ?? { periods: [], declining: false };
}
