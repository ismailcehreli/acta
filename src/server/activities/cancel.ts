import type { Activity, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  lockActivityForMaintenance,
} from "@/server/authz/activity-repository";

import { canViewActivity, type VisibilityDb } from "@/server/authz/visibility";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { isInManagementChain } from "@/server/org/chain";
import { closeFollowUpsForCancelledActivity } from "@/server/follow-ups/service";
import {
  acquireScoreMutationLock,
  enqueueScoreRecalculation,
} from "@/server/scoring/recalculation";

// Activity cancellation (§5.5).


export type CancelActivityDb = Pick<
  PrismaClient,
  | "activity"
  | "cancellationRecord"
  | "conversation"
  | "followUpItem"
  | "followUpItemEvent"
  | "notificationQueue"
  | "auditLog"
  | "user"
  | "orgUnit"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
  | "$transaction"
  | "$executeRaw"
> &
  VisibilityDb;

export type CancelError =
  | "not_found"
  | "not_allowed"
  | "already_cancelled"
  | "reason_required"

  | "not_cancellable";

export type CancelResult =
  | { ok: true; activity: Activity; closedConversationCount: number }
  | { ok: false; error: CancelError; message: string };



// (audit finding 1, 18.08.2026).
const MESSAGES: Record<CancelError, string> = {
  not_found: "Activity not found.",
  not_allowed: "Activity not found.",
  already_cancelled: "The activity has already been cancelled.",
  reason_required: "A cancellation reason is required.",
  not_cancellable:
    "This activity cannot be cancelled; cancellation is available only for recorded activities.",
};

function fail(error: CancelError): CancelResult {
  return { ok: false, error, message: MESSAGES[error] };
}


export async function canCancelActivity(
  db: VisibilityDb & Pick<PrismaClient, "user" | "orgUnit">,
  activity: Pick<Activity, "id" | "authorId" | "approvalStatus">,
  actor: { id: string; isSystemAdmin: boolean },
): Promise<boolean> {
  const level = await canViewActivity(db, actor, activity);
  if (level !== "full") return false;

  if (activity.authorId === actor.id) return true;
  return isInManagementChain(db, activity.authorId, actor.id);
}

export async function cancelActivity(
  db: CancelActivityDb,
  actor: { id: string; isSystemAdmin: boolean },
  activityId: string,
  reason: string,
  now: Date,
): Promise<CancelResult> {
  const actorId = actor.id;
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) return fail("reason_required");

  const activity = await activityMaintenanceReader(db).findUnique({ where: { id: activityId } });
  if (!activity) return fail("not_found");



  //


  if (!(await canCancelActivity(db, activity, actor))) {
    return fail("not_allowed");
  }

  if (activity.approvalStatus === "CANCELLED") return fail("already_cancelled");



  // (audit finding 6, 18.08.2026).
  if (activity.approvalStatus !== "APPROVED") return fail("not_cancellable");

  const result = await db.$transaction(async (tx) => {
    await acquireScoreMutationLock(tx);




    await lockActivityForMaintenance(tx, activityId);


    // The status may have changed while the row was unlocked.
    const fresh = await activityMaintenanceReader(tx).findUnique({
      where: { id: activityId },
      select: {
        id: true,
        authorId: true,
        activityDate: true,
        approvalStatus: true,
      },
    });
    if (!fresh || fresh.approvalStatus !== "APPROVED") return null;






    if (!(await canCancelActivity(tx, fresh, actor))) return null;

    const openConversations = await tx.conversation.findMany({
      where: { activityId, status: "OPEN" },
      select: { id: true, askerId: true, responsibleId: true },
    });

    const cancelled = await tx.activity.update({
      where: { id: activityId },
      data: { approvalStatus: "CANCELLED", updatedAt: now },
    });

    await tx.cancellationRecord.create({
      data: {
        activityId,
        cancelledById: actorId,
        reason: trimmedReason,
        createdAt: now,
      },
    });

    await enqueueScoreRecalculation(tx, {
      userId: fresh.authorId,
      activityDate: fresh.activityDate,
      sourceType: "ACTIVITY_CANCELLED",
      sourceId: activityId,
      now,
    });




    await closeFollowUpsForCancelledActivity(tx, activityId, actorId, now);






    for (const conversation of openConversations) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status: "CLOSED",
          closedById: actorId,
          closedAt: now,
          closeType: "CANCELLED_ACTIVITY",
        },
      });
    }




    const recipients = new Set<string>();
    for (const conversation of openConversations) {
      recipients.add(conversation.askerId);
      recipients.add(conversation.responsibleId);
    }
    recipients.delete(actorId);

    for (const userId of recipients) {

      await enqueueNotification(tx, {
        userId,
        eventType: NOTIFICATION_EVENTS.activityCancelled,
        payload: {
          activityId,
          activityTitle: activity.title,
          reason: trimmedReason,
        },
        idempotencyKey: `activity_cancelled:${activityId}:${userId}`,
        now,
      });
    }

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.activity,
      objectId: activityId,
      action: AUDIT_ACTIONS.activityCancelled,
      // The reason text is **not copied to the audit trail**: system
      // administrators can see the audit entry without accessing content
      // (§15.1). The reason remains on the cancellation record and follows
      // the visibility module.
      detail: { closedConversationCount: openConversations.length },
      now,
    });

    // Refresh the participants of closed conversations, the activity author,
    // and the cancelling user. Unlike a notification list, the cancelling
    // user is included because their screen also changed (Task 7.3).
    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.activityCancelled,
      userIds: [...recipients, activity.authorId, actorId],
    });

    return { cancelled, closedConversationCount: openConversations.length };
  });

  // A concurrent cancellation changes the state, so there is no result.
  if (result === null) return fail("already_cancelled");

  return {
    ok: true,
    activity: result.cancelled,
    closedConversationCount: result.closedConversationCount,
  };
}
