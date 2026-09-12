import type { PrismaClient } from "@prisma/client";

// Immutable record of an approval round (audit 23.08.2026, P3-R2-1).
//
// `Activity.approvalSubmittedAt` means "how long has it been waiting currently"
// and is cleared when a decision is made — correct for reminder counters, but
// destructive for measurement: at the moment of decision, submission time is lost
// and the question of "how many work days did it take to decide" remained unanswered.
// Scoring is therefore fed from here instead of live columns.
//
// Second reason for a separate table: an activity can be revised and resubmitted.
// A single column overwrites the first round when writing the second;
// a row per round preserves each round's own duration.

export type ApprovalRoundDb = Pick<PrismaClient, "approvalRound">;

/**
 * Decisions that can close a round.
 *
 * Not the entire `ActivityApprovalStatus` set: cancellation is not an approval
 * decision (the author or upstream chain cancels; the approval queue is empty
 * at that point) and "manager not found" is not a decision, but a failure state.
 * The database enforces the same restriction via `ApprovalRound_gecerli_karar` constraint.
 */
export type ApprovalDecision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/**
 * Opens a new round: work has appeared before the approver.
 *
 * Round number is max + 1; partial unique index prevents a second open round
 * at the database level.
 */
export async function openApprovalRound(
  db: ApprovalRoundDb,
  activityId: string,
  now: Date,
): Promise<void> {
  const latestRound = await db.approvalRound.findFirst({
    where: { activityId },
    orderBy: { roundNo: "desc" },
    select: { roundNo: true },
  });

  await db.approvalRound.create({
    data: {
      activityId,
      roundNo: (latestRound?.roundNo ?? 0) + 1,
      submittedAt: now,
    },
  });
}

/**
 * Decides on an open round. Rejection is also a decision and closes the same row.
 *
 * An open round cannot be silently ignored: if the decision history is missing,
 * scoring never sees that decision and the manager receives full score for an
 * unmeasured dimension.
 */
export async function closeApprovalRound(
  db: ApprovalRoundDb,
  activityId: string,
  decidedById: string,
  decision: ApprovalDecision,
  now: Date,
  /**
   * Action to take if no open round exists.
   *
   * "error" is default: decision is made while work is before approver and in that
   * state an open round must exist; missing round means incomplete history.
   *
   * "skip" is valid in one case only: when changes were requested and the activity
   * is subsequently rejected. At that time work is before the author, approver is
   * not awaited; there is no duration to measure.
   */
  onMissingRound: "error" | "skip" = "error",
): Promise<void> {
  const openRound = await db.approvalRound.findFirst({
    where: { activityId, decidedAt: null },
    orderBy: { roundNo: "desc" },
    select: { id: true },
  });

  if (!openRound) {
    if (onMissingRound === "skip") return;

    throw new Error(
      `Approval round not found: ${activityId}. A decision cannot be made without an open round.`,
    );
  }

  await db.approvalRound.update({
    where: { id: openRound.id },
    data: { decidedAt: now, decidedById, decision },
  });
}
