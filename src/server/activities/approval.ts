import type {
  Activity,
  ActivityApprovalStatus,
  ApprovalReasonKind,
  PrismaClient,
} from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  lockActivityForMaintenance,
  listAuthorizedActivities,
} from "@/server/authz/activity-repository";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { activeDeputyFor } from "@/server/authz/deputy";
import { approvalQueueWhere } from "@/server/authz/visibility";
import { resolveManagers } from "@/server/org/resolve-manager";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";
import {
  acquireScoreMutationLock,
  enqueueScoreRecalculation,
} from "@/server/scoring/recalculation";

import { closeApprovalRound } from "./approval-rounds";

// Approval flow (§5.4 status model, §8.2 authorization matrix).
// State transitions are enforced by the database and the transaction below.

// pending approval → approved
// pending approval / changes requested → manager not found (§4.4 error state)

export type ApprovalDb = Pick<
  PrismaClient,
  | "activity"
  | "approvalRound"
  | "approvalReason"
  | "user"
  | "orgUnit"
  | "notificationQueue"
  | "systemSetting"
  | "auditLog"
  | "$transaction"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "noActivityPeriod"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
>;

export type ApprovalError =
  | "not_found"
  | "not_approver"
  | "wrong_status"
  | "reason_required"
  | "conflict";

export type ApprovalResult =
  | { ok: true; value: Activity }
  | { ok: false; error: ApprovalError; message: string };

const MESSAGES: Record<ApprovalError, string> = {
  not_found: "Activity not found.",
  not_approver: "You are not an approver for this activity.",
  wrong_status: "The activity is not awaiting approval.",
  reason_required: "Select a valid reason.",
  conflict: "The activity changed while you were working. Refresh the page and try again.",
};

function fail(error: ApprovalError): ApprovalResult {
  return { ok: false, error, message: MESSAGES[error] };
}


export async function resolveInitialApproval(
  db: Pick<PrismaClient, "user" | "orgUnit">,
  author: { id: string; requiresApproval: boolean },
): Promise<
  | { status: "APPROVED"; approverId: null; approverIds: string[] }
  | { status: "PENDING_APPROVAL"; approverId: string; approverIds: string[] }
  | { status: "MANAGER_NOT_FOUND"; approverId: null; approverIds: string[] }
> {
  if (!author.requiresApproval) {
    return { status: "APPROVED", approverId: null, approverIds: [] };
  }

  const authorRecord = await db.user.findUnique({
    where: { id: author.id },
    select: { isUnitManager: true },
  });



  if (authorRecord?.isUnitManager) {
    return { status: "APPROVED", approverId: null, approverIds: [] };
  }




  const managers = await resolveManagers(db, author.id);

  if (!managers.found) {
    return { status: "MANAGER_NOT_FOUND", approverId: null, approverIds: [] };
  }

  return {
    status: "PENDING_APPROVAL",
    approverId: managers.managerIds[0],
    approverIds: managers.managerIds,
  };
}


async function withLockedActivity(
  db: ApprovalDb,
  activityId: string,
  actorId: string,
  now: Date,
  expectedStatuses: ActivityApprovalStatus[],
  operation: (
    tx: ApprovalDb,
    currentActivity: {
      id: string;
      authorId: string;
      activityDate: Date;
      title: string;

      eligibleApproverIds: string[];

      onBehalfOfId: string | null;

      status: ActivityApprovalStatus;
    },
  ) => Promise<Activity>,
): Promise<ApprovalResult> {
  const activity = await activityMaintenanceReader(db).findUnique({
    where: { id: activityId },
    select: {
      id: true,
      authorId: true,
      activityDate: true,
      title: true,
      approverId: true,
      approvalStatus: true,
      eligibleApprovers: { select: { userId: true } },
    },
  });




  if (!activity) return fail("not_found");



  const eligibleApproverIds = new Set(
    activity.eligibleApprovers.map((row) => row.userId),
  );



  //



  const deputyIds = await activeDeputyFor(db, actorId, now);

  if (
    !eligibleApproverIds.has(actorId) &&
    !deputyIds.some((personId) => eligibleApproverIds.has(personId))
  ) {
    return fail("not_found");
  }

  if (!expectedStatuses.includes(activity.approvalStatus)) {
    return fail("wrong_status");
  }

  const result = await db.$transaction(async (tx) => {
    const transactionDb = tx as unknown as ApprovalDb;




    await acquireScoreMutationLock(tx);


    // Both requests could reach this point concurrently, and the second could
    // overwrite the result of the first.
    await lockActivityForMaintenance(transactionDb, activityId);

    const fresh = await activityMaintenanceReader(transactionDb).findUnique({
      where: { id: activityId },
      select: {
        approvalStatus: true,
        eligibleApprovers: { select: { userId: true } },
      },
    });

    if (!fresh) return null;



    const freshEligibleApproverIds = new Set(
      fresh.eligibleApprovers.map((row) => row.userId),
    );

    // **Delegations are re-read here as well** (audit 2026-08-21,





    const freshDeputyIds = await activeDeputyFor(transactionDb, actorId, now);
    const onBehalfOfId = freshDeputyIds.find((personId) =>
      freshEligibleApproverIds.has(personId),
    );

    const stillAuthorized =
      freshEligibleApproverIds.has(actorId) || onBehalfOfId !== undefined;

    if (!stillAuthorized) return null;
    if (!expectedStatuses.includes(fresh.approvalStatus)) return null;

    return operation(transactionDb, {
      id: activity.id,
      authorId: activity.authorId,
      activityDate: activity.activityDate,
      title: activity.title,


      eligibleApproverIds: [...freshEligibleApproverIds],


      onBehalfOfId: onBehalfOfId ?? null,
      status: fresh.approvalStatus,
    });
  });

  if (result === null) return fail("conflict");
  return { ok: true, value: result };
}

export async function approveActivity(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  now: Date,
): Promise<ApprovalResult> {
  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL"],
    async (tx, currentActivity) => {
      const current = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "APPROVED",


          approverId: actorId,
          approvalDecidedAt: now,
          approvalSubmittedAt: null,


          approvalReasonId: null,
          approvalReasonKind: null,
          approvalReasonNote: null,
        },
      });



      await closeApprovalRound(tx, activityId, actorId, "APPROVED", now);
      await enqueueScoreRecalculation(tx, {
        userId: currentActivity.authorId,
        activityDate: currentActivity.activityDate,
        sourceType: "ACTIVITY_APPROVED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: currentActivity.authorId,
        eventType: NOTIFICATION_EVENTS.activityApproved,
        payload: { activityId, activityTitle: currentActivity.title },
        idempotencyKey: `activity_approved:${activityId}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // A delegated decision records the covered approver as "on behalf of".
        actualUserId: currentActivity.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityApproved,
        // The audit trail does not contain record content (§15.1).
        now,
      });

      // Notify every eligible approver so the decided activity leaves each
      // queue, including the second approver in a dual-manager unit.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [currentActivity.authorId, actorId, ...currentActivity.eligibleApproverIds],
      });

      return current;
    },
  );
}

/**
 * Verifies that a reason category exists, is active, and has the expected
 * kind. The database also enforces the kind with a compound foreign key;
 * this lookup provides a useful response before the write is attempted.
 */
async function resolveReason(
  db: ApprovalDb,
  kind: ApprovalReasonKind,
  reasonId: string,
): Promise<{ id: string } | null> {
  const reason = await db.approvalReason.findFirst({
    where: { id: reasonId, kind, isActive: true },
    select: { id: true },
  });

  return reason;
}

export interface ApprovalDecisionInput {
  /** Category defined by a system administrator; required. */
  reasonId: string;
  /** Free-form explanation; optional. */
  note?: string | null;
}

export async function requestChanges(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  input: ApprovalDecisionInput,
  now: Date,
): Promise<ApprovalResult> {
  const reason = await resolveReason(db, "CHANGES_REQUESTED", input.reasonId);
  if (!reason) return fail("reason_required");

  const not = input.note?.trim() ?? "";

  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL"],
    async (tx, currentActivity) => {
      const current = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "CHANGES_REQUESTED",
          approverId: actorId,
          approvalDecidedAt: now,
          // The turn returns to the author, so the approval timer stops.
          approvalSubmittedAt: null,
          approvalReasonId: reason.id,
          approvalReasonKind: "CHANGES_REQUESTED",
          approvalReasonNote: not === "" ? null : not,
        },
      });

      // Close the turn without losing its submission timestamp (P3-R2-1).
      // A rejection is also a decision and closes the same row.
      await closeApprovalRound(tx, activityId, actorId, "CHANGES_REQUESTED", now);
      await enqueueScoreRecalculation(tx, {
        userId: currentActivity.authorId,
        activityDate: currentActivity.activityDate,
        sourceType: "ACTIVITY_CHANGES_REQUESTED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: currentActivity.authorId,
        eventType: NOTIFICATION_EVENTS.changesRequested,
        // The reason text is not included in notifications (§12.3).
        payload: { activityId, activityTitle: currentActivity.title },
        idempotencyKey: `changes_requested:${activityId}:${now.getTime()}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // A delegated decision records the covered approver as "on behalf of".
        actualUserId: currentActivity.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityChangesRequested,
        // Store the category in the audit trail for reporting; free-form
        // explanation is content and is intentionally excluded (§15.1).
        detail: { reasonId: reason.id },
        now,
      });

      // Notify every eligible approver so the decided activity leaves each
      // queue, including the second approver in a dual-manager unit.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [currentActivity.authorId, actorId, ...currentActivity.eligibleApproverIds],
      });

      return current;
    },
  );
}

/**
 * Rejection (a product decision from 19.08.2026) differs from cancellation:
 * cancellation withdraws a published record, while rejection means the
 * record was never accepted. Keeping them separate preserves audit meaning.
 *
 * A `CHANGES_REQUESTED` record can also be rejected. Otherwise a record could
 * remain pending forever when its author never submits a revision.
 *
 * Rejected records are not deleted (§16.6) and do not move upward: the author
 * and decision-maker can see them, while higher levels cannot. This is the
 * purpose of the visibility filter.
 */
export async function rejectActivity(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  input: ApprovalDecisionInput,
  now: Date,
): Promise<ApprovalResult> {
  const reason = await resolveReason(db, "REJECTED", input.reasonId);
  if (!reason) return fail("reason_required");

  const not = input.note?.trim() ?? "";

  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL", "CHANGES_REQUESTED"],
    async (tx, currentActivity) => {
      const current = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "REJECTED",
          approverId: actorId,
          approvalDecidedAt: now,
          approvalSubmittedAt: null,
          approvalReasonId: reason.id,
          approvalReasonKind: "REJECTED",
          approvalReasonNote: not === "" ? null : not,
        },
      });

      // Close the turn without losing its submission timestamp (P3-R2-1).
      // A revision-requested record has no open turn because it is with the
      // author; a pending record must have one so approval time is measured.
      await closeApprovalRound(
        tx,
        activityId,
        actorId,
        "REJECTED",
        now,
        currentActivity.status === "CHANGES_REQUESTED" ? "skip" : "error",
      );
      await enqueueScoreRecalculation(tx, {
        userId: currentActivity.authorId,
        activityDate: currentActivity.activityDate,
        sourceType: "ACTIVITY_REJECTED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: currentActivity.authorId,
        eventType: NOTIFICATION_EVENTS.activityRejected,
        payload: { activityId, activityTitle: currentActivity.title },
        idempotencyKey: `activity_rejected:${activityId}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // A delegated decision records the covered approver as "on behalf of".
        actualUserId: currentActivity.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityRejected,
        detail: { reasonId: reason.id },
        now,
      });

      // Notify every eligible approver so the decided activity leaves each
      // queue, including the second approver in a dual-manager unit.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [currentActivity.authorId, actorId, ...currentActivity.eligibleApproverIds],
      });

      return current;
    },
  );
}

/** Activities awaiting this user's approval (§13.1). */
/**
 * Can this user decide this activity?
 *
 * The screen and the action must use the same authorization source. The
 * detail screen previously checked `activity.approverId === user.id`, a
 * leftover from the single-approver model that failed in two cases:
 *
 *   · The second approver in a dual-manager unit saw no approval panel.
 *   · A deputy saw no approval panel during an active delegation.
 *
 * The server action accepted both decisions, but the user could not reach the
 * action because the button was hidden. Authorization is still verified by
 * the action; this function only controls panel visibility.
 */
export async function canDecideOnActivity(
  db: Pick<PrismaClient, "activityApprover" | "noActivityPeriod">,
  userId: string,
  activityId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const theirDeputies = await activeDeputyFor(db, userId, now);

  const row = await db.activityApprover.findFirst({
    where: { activityId, userId: { in: [userId, ...theirDeputies] } },
    select: { userId: true },
  });

  return row !== null;
}

export async function listPendingApprovals(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
): Promise<
  {
    id: string;
    title: string;
    activityDate: Date;
    authorName: string;
    authorUnitName: string;
  }[]
> {
  const rows = await listAuthorizedActivities(db, approvalQueueWhere(approverId, now), {
    // The queue predicate comes from the visibility module (§8). It resolves
    // delegation inside the query rather than from a separately read ID list,
    // keeping every queue screen consistent (audit finding 2, 21.08.2026).
    where: { approvalStatus: "PENDING_APPROVAL" },
    orderBy: [{ activityDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      activityDate: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    activityDate: row.activityDate,
    authorName: row.author.fullName,
    authorUnitName: row.authorOrgUnit.name,
  }));
}
