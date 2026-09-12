import type { Prisma, PrismaClient } from "@prisma/client";

import {
  SETTING_KEYS,
  readBooleanSetting,
} from "@/server/settings/system-settings";
import { companyDay, nextCompanyDayStart } from "@/shared/format/date-time";

import {
  collectScoreInputs,
  loadScoreContext,
  type ScoreCollectDb,
} from "./collect";
import {
  computeScoreByVersion,
  resolveScoreProfile,
  SCORE_FORMULA_VERSION,
} from "./compute";
import {
  loadHistoricalScoreEnvironment,
  retroactiveEntryDaysAtPeriodEnd,
  type HistoricalScoreEnvironment,
  type HistoricalScoreUser,
} from "./history";
import { acquireScoreClosureLock } from "./recalculation";


//




export type ClosePeriodDb = ScoreCollectDb &
  Pick<
    PrismaClient,
    | "userScorePeriod"
    | "userScorePeriodFact"
    | "scoreHistoryControl"
    | "scorePeriodLedger"
    | "scoreRecalculationRequest"
    | "systemSetting"
    | "$transaction"
    | "$executeRaw"
  >;

export interface ClosePeriodOutcome {

  written: number;

  periodStart: string | null;
}

export interface ScorePeriodWorkBatchOutcome {

  processed: number;

  written: number;

  periodStarts: string[];

  exhaustedItemBudget: boolean;

  exhaustedTimeBudget: boolean;
}

export interface ScorePeriodWorkBatchOptions {
  maxItems?: number;
  maxDurationMs?: number;
}

const DEFAULT_SCORE_WORK_MAX_ITEMS = 20;
const DEFAULT_SCORE_WORK_MAX_DURATION_MS = 20_000;

interface PeriodBounds {
  from: Date;
  to: Date;
}

interface MissingPeriod {
  bounds: PeriodBounds;
  retroactiveDays: number;
}

function monthStart(year: number, zeroBasedMonth: number): Date {
  return new Date(Date.UTC(year, zeroBasedMonth, 1));
}

function nextMonth(start: Date): Date {
  return monthStart(start.getUTCFullYear(), start.getUTCMonth() + 1);
}

function periodBounds(start: Date): PeriodBounds {
  return {
    from: start,
    to: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)),
  };
}

function previousCompanyMonth(now: Date): Date {
  const [yearText, monthText] = companyDay(now).split("-");
  return monthStart(Number(yearText), Number(monthText) - 2);
}

function dayValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function closingEligible(now: Date, end: Date, retroactiveDays: number): boolean {
  const lastEntryDay = new Date(end);
  lastEntryDay.setUTCDate(lastEntryDay.getUTCDate() + retroactiveDays);
  return companyDay(now) > dayValue(lastEntryDay);
}


async function nextMissingPeriod(
  db: Prisma.TransactionClient,
  now: Date,
): Promise<MissingPeriod | null> {
  const control = await db.scoreHistoryControl.findUnique({ where: { id: 1 } });
  const first = control?.historyStart ?? previousCompanyMonth(now);
  const last = previousCompanyMonth(now);
  if (first > last) return null;

  const ledgers = await db.scorePeriodLedger.findMany({
    where: { periodStart: { gte: first, lte: last } },
    select: { periodStart: true },
  });
  const closed = new Set(ledgers.map((row) => dayValue(row.periodStart)));

  for (let cursor = new Date(first); cursor <= last; cursor = nextMonth(cursor)) {
    if (closed.has(dayValue(cursor))) continue;
    const bounds = periodBounds(cursor);
    const retroactiveDays = await retroactiveEntryDaysAtPeriodEnd(db, bounds.to);
    if (!closingEligible(now, bounds.to, retroactiveDays)) continue;
    return { bounds, retroactiveDays };
  }

  return null;
}

interface RevisionCause {
  reason: string;
  requestId: string | null;
}


class RecalculationProcessingError extends Error {
  readonly requestId: string;

  constructor(requestId: string, cause: unknown) {
    super(String(cause), { cause });
    this.name = "RecalculationProcessingError";
    this.requestId = requestId;
  }
}


async function writeRevision(
  tx: Prisma.TransactionClient,
  input: {
    user: {
      id: string;
      activeFrom: Date;
      activeTo: Date;
      isUnitManager: boolean;
      orgUnitId: string;
      requiresApproval: boolean;
    };
    bounds: PeriodBounds;
    now: Date;
    cause: RevisionCause;
    environment: HistoricalScoreEnvironment;
    formulaVersion: number;
  },
): Promise<number> {
  const latest = await tx.userScorePeriod.findFirst({
    where: { userId: input.user.id, periodStart: input.bounds.from },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  const revisionNo = (latest?.revisionNo ?? 0) + 1;

  const until = nextCompanyDayStart(companyDay(input.user.activeTo));
  const context = await loadScoreContext(tx, {
    id: input.user.id,
    isSystemAdmin: false,
  });
  context.calendarIndex = input.environment.unitCalendarIndex;
  context.calendarSetting = {
    workingDays:
      input.environment.companyCalendar.workingDays ?? [1, 2, 3, 4, 5],
  };
  context.approvalThreshold = input.environment.approvalThreshold;
  context.answerThreshold = input.environment.answerThreshold;
  context.followUpThreshold = input.environment.followUpThreshold;
  context.appreciationPointsPer = input.environment.appreciationPointsPer;

  const collected = await collectScoreInputs(
    tx,
    context,
    [input.user.id],
    input.user.activeFrom,
    input.user.activeTo,
    until,
    {
      orgUnitByUser: new Map([[input.user.id, input.user.orgUnitId]]),
      companyCalendar: input.environment.companyCalendar,
    },
  );
  const scoreInput = collected.get(input.user.id);
  if (!scoreInput) {
    throw new Error(`Could not build score input: ${input.user.id}`);
  }
  const weights = input.environment.weights;

  const profile = resolveScoreProfile({
    isUnitManager: input.user.isUnitManager,
    requiresApproval: input.user.requiresApproval,
  });
  // `computeScore` delegates to the registered calculator for the requested
  // version; the stored label and the algorithm cannot diverge.
  const score = computeScoreByVersion(
    input.formulaVersion,
    profile,
    scoreInput,
    weights,
  );

  await tx.userScorePeriod.create({
    data: {
      userId: input.user.id,
      periodStart: input.bounds.from,
      revisionNo,
      revisionReason: input.cause.reason,
      sourceRequestId: input.cause.requestId,
      regularity: score.regularity,
      acceptance: score.acceptance,
      approval: score.approval,
      followUp: score.followUp,
      total: score.total,
      expectedDays: scoreInput.expectedDays,
      writtenDays: scoreInput.writtenDays,
      appreciationPointsPer: scoreInput.appreciationPointsPer ?? 0,
      frozen: false,
      computedAt: input.now,
    },
  });

  if (scoreInput.facts.length > 0) {
    await tx.userScorePeriodFact.createMany({
      data: scoreInput.facts.map((fact) => ({
        userId: input.user.id,
        periodStart: input.bounds.from,
        revisionNo,
        activityId: fact.activityId,
        kind: fact.kind,
        happenedOn: new Date(`${fact.happenedOn}T00:00:00.000Z`),
        onTime: fact.onTime,
      })),
    });
  }

  await tx.userScorePeriod.update({
    where: {
      userId_periodStart_revisionNo: {
        userId: input.user.id,
        periodStart: input.bounds.from,
        revisionNo,
      },
    },
    data: {
      frozen: true,
      profile,
      weightRegularity: weights.regularity,
      weightAcceptance: weights.acceptance,
      weightApproval: weights.approval,
      weightFollowUp: weights.followUp,
      formulaVersion: input.formulaVersion,
    },
  });

  return revisionNo;
}

/**
 * Voids a previous revision without deleting it when a historical correction
 * shows that the user should never have been in scope for the period.
 * Numeric fields are copied from the latest immutable revision; because the
 * new row is `voided`, no read path presents it as a person's scorecard.
 */
async function writeVoidedRevision(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    periodStart: Date;
    now: Date;
    cause: RevisionCause;
    previous: {
      revisionNo: number;
      regularity: number;
      acceptance: number | null;
      approval: number | null;
      followUp: number;
      total: number;
      expectedDays: number;
      writtenDays: number;
      profile: string | null;
      weightRegularity: number | null;
      weightAcceptance: number | null;
      weightApproval: number | null;
      weightFollowUp: number | null;
      appreciationPointsPer: number;
      formulaVersion: number | null;
    };
  },
): Promise<void> {
  if (
    input.previous.profile === null ||
    input.previous.weightRegularity === null ||
    input.previous.weightAcceptance === null ||
    input.previous.weightApproval === null ||
    input.previous.weightFollowUp === null ||
    input.previous.formulaVersion === null
  ) {
    throw new Error(
      `Score revision to void is missing its formula snapshot: ${input.userId}`,
    );
  }

  await tx.userScorePeriod.create({
    data: {
      userId: input.userId,
      periodStart: input.periodStart,
      revisionNo: input.previous.revisionNo + 1,
      revisionReason: input.cause.reason,
      sourceRequestId: input.cause.requestId,
      voided: true,
      frozen: true,
      regularity: input.previous.regularity,
      acceptance: input.previous.acceptance,
      approval: input.previous.approval,
      followUp: input.previous.followUp,
      total: input.previous.total,
      expectedDays: input.previous.expectedDays,
      writtenDays: input.previous.writtenDays,
      profile: input.previous.profile,
      weightRegularity: input.previous.weightRegularity,
      weightAcceptance: input.previous.weightAcceptance,
      weightApproval: input.previous.weightApproval,
      weightFollowUp: input.previous.weightFollowUp,
      appreciationPointsPer: input.previous.appreciationPointsPer,
      formulaVersion: input.previous.formulaVersion,
      computedAt: input.now,
    },
  });
}

/**
 * Returns the formula version used when the period was first closed.
 *
 * A user added to scope later must receive their first scorecard with the
 * same version; otherwise one month would contain scorecards calculated by
 * different algorithms.
 */
async function periodFormulaVersion(
  tx: Prisma.TransactionClient,
  periodStart: Date,
): Promise<number> {
  const ledger = await tx.scorePeriodLedger.findUnique({
    where: { periodStart },
    select: { formulaVersion: true },
  });
  if (!ledger) {
    throw new Error(
      `Score correction requested for an unclosed period: ${dayValue(periodStart)}`,
    );
  }
  return ledger.formulaVersion;
}

async function processRecalculation(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<ClosePeriodOutcome | null> {
  const request = await tx.scoreRecalculationRequest.findFirst({
    where: { processedAt: null },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
  });
  if (!request) return null;

  try {
    // Requests accumulated for the same user and month are merged into one
    // new revision. The worker takes the new revision's data snapshot at
    // `now`.
    const grouped = await tx.scoreRecalculationRequest.findMany({
      where: {
        userId: request.userId,
        periodStart: request.periodStart,
        processedAt: null,
        requestedAt: { lte: now },
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });

    const previousRevision = await tx.userScorePeriod.findFirst({
      where: {
        userId: request.userId,
        periodStart: request.periodStart,
        frozen: true,
      },
      orderBy: { revisionNo: "desc" },
      select: {
        revisionNo: true,
        regularity: true,
        acceptance: true,
        approval: true,
        followUp: true,
        total: true,
        expectedDays: true,
        writtenDays: true,
        profile: true,
        weightRegularity: true,
        weightAcceptance: true,
        weightApproval: true,
        weightFollowUp: true,
        appreciationPointsPer: true,
        formulaVersion: true,
      },
    });
    const bounds = periodBounds(request.periodStart);
    const environment = await loadHistoricalScoreEnvironment(
      tx,
      bounds.from,
      bounds.to,
    );
    const historicalUser = environment.users.find(
      (row) => row.id === request.userId,
    );

    const consume = async () => {
      await tx.scoreRecalculationRequest.updateMany({
        where: { id: { in: grouped.map((row) => row.id) } },
        data: { processedAt: now, attempts: { increment: 1 }, lastError: null },
      });
    };

    // **The distinction is historical eligibility, not scorecard existence**
    // (audit 25.08.2026, P8-R5-2). If the person was not in scope for the
    // period and has no scorecard, there is nothing to correct. The stale
    // request may come from a migration, manual intervention, or an old
    // application path; it is not a calculation failure. Consume the group,
    // otherwise the first row would be selected every cycle and valid requests
    // behind it would wait forever.
    if (!historicalUser && !previousRevision?.formulaVersion) {
      await consume();
      return { written: 0, periodStart: dayValue(request.periodStart) };
    }

    const user = await tx.user.findUnique({
      where: { id: request.userId },
      select: { id: true },
    });
    if (!user) {
      throw new Error(`Score correction user not found: ${request.userId}`);
    }

    const cause = { reason: request.sourceType, requestId: request.id };
    if (historicalUser) {
      // An existing scorecard means a data correction, not a formula
      // migration: preserve the period's calculation version. Without a
      // scorecard, an approved historical correction **adds** the person to
      // scope; write the first revision with the ledger's formula version.
      // Using the current version would silently reinterpret a closed period.
      const formulaVersion =
        previousRevision?.formulaVersion ??
        (await periodFormulaVersion(tx, request.periodStart));
      await writeRevision(tx, {
        user: historicalUser,
        bounds,
        now,
        cause,
        environment,
        formulaVersion,
      });
    } else if (previousRevision?.formulaVersion) {
      await writeVoidedRevision(tx, {
        userId: request.userId,
        periodStart: request.periodStart,
        now,
        cause,
        previous: previousRevision,
      });
    }

    await consume();

    return { written: 1, periodStart: dayValue(request.periodStart) };
  } catch (error) {
    throw new RecalculationProcessingError(request.id, error);
  }
}

async function closeInitialPeriod(
  tx: Prisma.TransactionClient,
  bounds: PeriodBounds,
  now: Date,
  retroactiveDays: number,
  formulaVersion: number,
): Promise<ClosePeriodOutcome> {
  const environment = await loadHistoricalScoreEnvironment(tx, bounds.from, bounds.to);
  const users: HistoricalScoreUser[] = environment.users;

  let written = 0;
  for (const user of users) {
    await writeRevision(tx, {
      user,
      bounds,
      now,
      cause: { reason: "INITIAL", requestId: null },
      environment,
      formulaVersion,
    });
    written += 1;
  }

  // A month with no users is also marked complete so the worker does not
  // select it again.
  await tx.scorePeriodLedger.create({
    data: {
      periodStart: bounds.from,
      closedAt: now,
      retroactiveDays,
      formulaVersion,
    },
  });

  return { written, periodStart: dayValue(bounds.from) };
}

export async function closeScorePeriod(
  db: ClosePeriodDb,
  now: Date,
  options: { formulaVersion?: number } = {},
): Promise<ClosePeriodOutcome> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.scoringEnabled))) {
    return { written: 0, periodStart: null };
  }

  const formulaVersion = options.formulaVersion ?? SCORE_FORMULA_VERSION;
  if (!Number.isInteger(formulaVersion) || formulaVersion < 1) {
    throw new Error(`Invalid score formula version: ${formulaVersion}`);
  }

  // Initial closure and correction share the same global lock. This prevents
  // two workers from generating the same revision number for one user-month
  // and keeps the period ledger fresh between selection and write.
  try {
    return await db.$transaction(async (tx) => {
      await acquireScoreClosureLock(tx);

      const missing = await nextMissingPeriod(tx, now);
      if (missing) {
        return closeInitialPeriod(
          tx,
          missing.bounds,
          now,
          missing.retroactiveDays,
          formulaVersion,
        );
      }

      const correction = await processRecalculation(tx, now);
      return correction ?? { written: 0, periodStart: null };
    });
  } catch (error) {
    if (error instanceof RecalculationProcessingError) {
      await db.scoreRecalculationRequest.updateMany({
        where: { id: error.requestId, processedAt: null },
        data: {
          attempts: { increment: 1 },
          lastError: String(error).slice(0, 4_000),
        },
      });
    }
    throw error;
  }
}

/**
 * Processes multiple independent score jobs in one worker cycle.
 *
 * Each `closeScorePeriod` call has its own transaction and short exclusive
 * lock. Batching does not create one long transaction; one correction failure
 * does not roll back earlier successes.
 */
export async function drainScorePeriodWork(
  db: ClosePeriodDb,
  now: Date,
  options: ScorePeriodWorkBatchOptions = {},
): Promise<ScorePeriodWorkBatchOutcome> {
  const maxItems = options.maxItems ?? DEFAULT_SCORE_WORK_MAX_ITEMS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_SCORE_WORK_MAX_DURATION_MS;
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error("A score work batch must contain at least one item.");
  }
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1) {
    throw new Error("A score work batch duration must be positive.");
  }

  const startedAt = Date.now();
  const result: ScorePeriodWorkBatchOutcome = {
    processed: 0,
    written: 0,
    periodStarts: [],
    exhaustedItemBudget: false,
    exhaustedTimeBudget: false,
  };

  while (result.processed < maxItems) {
    if (Date.now() - startedAt >= maxDurationMs) {
      result.exhaustedTimeBudget = true;
      return result;
    }

    const outcome = await closeScorePeriod(db, now);
    if (outcome.periodStart === null) return result;

    result.processed += 1;
    result.written += outcome.written;
    result.periodStarts.push(outcome.periodStart);
  }

  result.exhaustedItemBudget = true;
  return result;
}
