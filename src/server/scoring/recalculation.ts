import type { Prisma, PrismaClient } from "@prisma/client";

export const SCORE_CLOSURE_LOCK_KEY = "acta:score_closure";


export function scorePeriodStart(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export type ScoreRecalculationDb = Pick<
  PrismaClient,
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
  | "$executeRaw"
>;


export async function acquireScoreClosureLock(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  lockKey = SCORE_CLOSURE_LOCK_KEY,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

/**
 * Shared transaction lock for normal score-affecting activity mutations.
 *
 * In shared mode, two activity writes do not block each other. The first close
 * takes the same key exclusively: it cannot start while writes are open and holds
 * the key until new writes are included in the score/queue decision.
 */
export async function acquireScoreMutationLock(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  lockKey = SCORE_CLOSURE_LOCK_KEY,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${lockKey}))`;
}

/**
 * Enqueue an idempotent request for a mutation affecting a frozen period.
 *
 * The function is called with the original mutation's transaction client. If the
 * period has not closed for the first time, no queue entry is needed; the first
 * close will collect the new data.
 */
export async function enqueueScoreRecalculation(
  db: ScoreRecalculationDb | Prisma.TransactionClient,
  input: {
    userId: string;
    activityDate: Date;
    sourceType: string;
    sourceId: string;
    now: Date;
  },
): Promise<void> {
  // Close the race between the first close and a mutation. If the close took the
  // lock first, this waits for the ledger row and then queues the request; if the
  // mutation took it first, the close sees the new data before sealing the period.
  // Otherwise both could proceed and leave a decision/activity out of both the
  // first revision and the queue.
  await acquireScoreMutationLock(db);

  const periodStart = scorePeriodStart(input.activityDate);
  const closed = await db.scorePeriodLedger.findUnique({
    where: { periodStart },
    select: { periodStart: true },
  });
  if (!closed) return;

  // A user outside the scoring scope has no scorecard for this period. Approval and
  // cancellation still apply, but queuing a recalculation would create a request
  // with no revision that the worker can process.
  const previous = await db.userScorePeriod.findFirst({
    where: { userId: input.userId, periodStart, frozen: true },
    select: { revisionNo: true },
  });
  if (!previous) return;

  await db.scoreRecalculationRequest.upsert({
    where: {
      userId_periodStart_sourceType_sourceId: {
        userId: input.userId,
        periodStart,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    update: {},
    create: {
      userId: input.userId,
      periodStart,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      requestedAt: input.now,
    },
  });
}
