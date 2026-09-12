import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  attachmentMaintenanceReader,
} from "@/server/authz/activity-repository";
import { deleteStoredFile } from "@/server/attachments/storage";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  acquireScoreMutationLock,
  scorePeriodStart,
} from "@/server/scoring/recalculation";


//



//


// The request must refer to an existing record.



// The database rejects deletion when the required state is absent.
//



//




export const DELETION_CODE_TTL_MS = 10 * 60_000;
export const MAX_DELETION_ATTEMPTS = 5;

export type DeletionDb = Pick<
  PrismaClient,
  | "activity"
  | "activityDeletionRequest"
  | "activityRevision"
  | "activityApprover"
  | "activityTargetDept"
  | "activityAppreciation"
  | "approvalRound"
  | "attachment"
  | "auditLog"
  | "cancellationRecord"
  | "conversation"
  | "conversationMessage"
  | "followUpItem"
  | "followUpItemEvent"
  | "notificationQueue"
  | "readReceipt"
  | "scorePeriodLedger"
  | "systemSetting"
  | "user"
  | "userScorePeriodFact"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "$transaction"
>;

export type DeletionError =
  | "not_root"
  | "not_found"
  | "period_closed"
  | "no_request"
  | "invalid_code"
  | "expired";

export type DeletionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DeletionError; message: string };

const MESSAGES: Record<DeletionError, string> = {
  not_root: "This operation is available only to the root system administrator.",
  not_found: "Activity not found.",
  period_closed:
    "The activity's score period is closed; a record in a closed period cannot be deleted.",
  no_request: "There is no valid deletion request. Request a new code.",
  invalid_code: "The code could not be verified.",
  expired: "The code has expired. Request a new code.",
};

function fail<T>(error: DeletionError): DeletionResult<T> {
  return { ok: false, error, message: MESSAGES[error] };
}

export interface DeletionActor {
  id: string;
  isRoot: boolean;
}


export interface ActivityDeletionTarget {
  id: string;
  title: string;
  activityDate: Date;
  authorName: string;
  authorUnitName: string;
  approvalStatus: string;
  attachmentCount: number;
  periodClosed: boolean;

  periodClosedAt: Date | null;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}


function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}


async function periodState(
  db: Pick<DeletionDb, "scorePeriodLedger" | "userScorePeriodFact">,
  activityId: string,
  activityDate: Date,
): Promise<{ closed: boolean; closedAt: Date | null }> {
  const [ledger, factCount] = await Promise.all([
    db.scorePeriodLedger.findUnique({
      where: { periodStart: scorePeriodStart(activityDate) },
      select: { closedAt: true },
    }),
    db.userScorePeriodFact.count({ where: { activityId } }),
  ]);

  if (ledger) return { closed: true, closedAt: ledger.closedAt };
  if (factCount > 0) return { closed: true, closedAt: null };
  return { closed: false, closedAt: null };
}

async function loadTarget(
  db: DeletionDb,
  activityId: string,
): Promise<ActivityDeletionTarget | null> {





  const activity = await activityMaintenanceReader(db).findUnique({
    where: { id: activityId },
    select: {
      id: true,
      title: true,
      activityDate: true,
      approvalStatus: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
      _count: { select: { attachments: true } },
    },
  });

  if (!activity) return null;

  const period = await periodState(db, activity.id, activity.activityDate);

  return {
    id: activity.id,
    title: activity.title,
    activityDate: activity.activityDate,
    authorName: activity.author.fullName,
    authorUnitName: activity.authorOrgUnit.name,
    approvalStatus: activity.approvalStatus,
    attachmentCount: activity._count.attachments,
    periodClosed: period.closed,
    periodClosedAt: period.closedAt,
  };
}


export async function describeActivityForDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
): Promise<DeletionResult<ActivityDeletionTarget>> {
  if (!actor.isRoot) return fail("not_root");

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");

  return { ok: true, value: target };
}


export async function requestActivityDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
  now: Date,
): Promise<DeletionResult<{ requestId: string; expiresAt: Date }>> {
  if (!actor.isRoot) return fail("not_root");

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");
  if (target.periodClosed) return fail("period_closed");


  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + DELETION_CODE_TTL_MS);

  const request = await db.$transaction(async (tx) => {
    await tx.activityDeletionRequest.updateMany({
      where: { activityId, consumedAt: null, cancelledAt: null },
      data: { cancelledAt: now },
    });

    const createdRequest = await tx.activityDeletionRequest.create({
      data: {
        activityId,
        activityTitle: target.title,
        activityDate: target.activityDate,
        activityAuthor: target.authorName,
        requestedById: actor.id,
        codeHash: hashCode(code),
        expiresAt,
        createdAt: now,
      },
      select: { id: true },
    });





    await enqueueNotification(tx as unknown as DeletionDb, {
      userId: actor.id,
      eventType: NOTIFICATION_EVENTS.activityDeletionCode,
      payload: {
        code,
        requestId: createdRequest.id,
        targetId: activityId,
        title: target.title,
      },
      idempotencyKey: `activity-deletion:${createdRequest.id}`,
      now,
    });

    return createdRequest;
  });

  await recordAudit(db, {
    userId: actor.id,
    objectType: AUDIT_OBJECTS.activity,
    objectId: activityId,
    action: AUDIT_ACTIONS.activityDeletionRequested,
    detail: { requestId: request.id, title: target.title },
    now,
  });

  return { ok: true, value: { requestId: request.id, expiresAt } };
}

/**
 * Verifies the code and permanently deletes the record.
 *
 * The deletion order follows the `Restrict` foreign keys, from leaves to the
 * root. If the order is wrong, the database rejects the operation rather
 * than leaving a silent partial deletion.
 */
export async function confirmActivityDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
  code: string,
  now: Date,
): Promise<DeletionResult<{ deletedTitle: string }>> {
  if (!actor.isRoot) return fail("not_root");

  const request = await db.activityDeletionRequest.findFirst({
    where: {
      activityId,
      requestedById: actor.id,
      consumedAt: null,
      cancelledAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!request) return fail("no_request");

  if (request.expiresAt.getTime() <= now.getTime()) {
    await db.activityDeletionRequest.update({
      where: { id: request.id },
      data: { cancelledAt: now },
    });
    return fail("expired");
  }

  if (!sameHash(request.codeHash, hashCode(code))) {
    const attempts = request.attemptCount + 1;
    await db.activityDeletionRequest.update({
      where: { id: request.id },
      data: {
        attemptCount: attempts,
        // Once the threshold is reached, cancel the request for the remaining
        // lifetime; the administrator must request a new code.
        ...(attempts >= MAX_DELETION_ATTEMPTS ? { cancelledAt: now } : {}),
      },
    });
    return fail("invalid_code");
  }

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");

  // Read attachment paths **before deletion**: their rows disappear inside
  // the transaction and cannot be queried afterwards.
  const filePaths = (
    await attachmentMaintenanceReader(db).findMany({
      where: { activityId },
      select: { storagePath: true },
    })
  ).map((attachment) => attachment.storagePath);

  // **Second period check.** Closure may have run after the request was made,
  // so check again while holding the mutation lock.
  const deleted = await db.$transaction(async (tx) => {
    const transactionDb = tx as unknown as DeletionDb;
    await acquireScoreMutationLock(tx);

    const period = await periodState(transactionDb, activityId, target.activityDate);
    if (period.closed) return "period_closed" as const;

    const activityRecord = await activityMaintenanceReader(transactionDb).findUnique({
      where: { id: activityId },
      select: { id: true, authorId: true, activityDate: true },
    });
    if (!activityRecord) return "not_found" as const;

    // Open the physical-deletion guard. `SET LOCAL` applies only to this
    // transaction, and this is the only application path that sets it.
    await tx.$executeRawUnsafe("SET LOCAL app.activity_delete = 'evet'");

    const conversations = await transactionDb.conversation.findMany({
      where: { activityId },
      select: { id: true },
    });
    const followUpItems = await transactionDb.followUpItem.findMany({
      where: { activityId },
      select: { id: true },
    });

    await transactionDb.conversationMessage.deleteMany({
      where: { conversationId: { in: conversations.map((row) => row.id) } },
    });
    await transactionDb.conversation.deleteMany({ where: { activityId } });

    await transactionDb.followUpItemEvent.deleteMany({
      where: { followUpId: { in: followUpItems.map((row) => row.id) } },
    });
    await transactionDb.followUpItem.deleteMany({ where: { activityId } });

    await transactionDb.activityAppreciation.deleteMany({ where: { activityId } });
    await transactionDb.readReceipt.deleteMany({ where: { activityId } });
    await transactionDb.attachment.deleteMany({ where: { activityId } });
    await transactionDb.cancellationRecord.deleteMany({ where: { activityId } });
    await transactionDb.activityTargetDept.deleteMany({ where: { activityId } });
    await transactionDb.activityRevision.deleteMany({ where: { activityId } });
    await transactionDb.activityApprover.deleteMany({ where: { activityId } });
    await transactionDb.approvalRound.deleteMany({ where: { activityId } });
    await transactionDb.notificationQueue.deleteMany({ where: { activityId } });

    await transactionDb.activity.delete({ where: { id: activityId } });

    await transactionDb.activityDeletionRequest.update({
      where: { id: request.id },
      data: { consumedAt: now },
    });

    // No score recalculation is needed here. A closed period is protected;
    // an open period is calculated live, so the deleted activity disappears
    // automatically. Recalculation requests exist only for frozen score
    // records, and the lock above closes the race with period closure.

    // Write the audit trail in the same transaction (§15.2). `objectId` is not
    // a foreign key, so the audit entry can still identify the deleted record.
    await recordAudit(transactionDb, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.activity,
      objectId: activityId,
      action: AUDIT_ACTIONS.activityDeleted,
      detail: {
        title: target.title,
        activityDate: target.activityDate.toISOString().slice(0, 10),
        author: target.authorName,
        requestId: request.id,
      },
      now,
    });

    return "ok" as const;
  });

  if (deleted === "period_closed") return fail("period_closed");
  if (deleted === "not_found") return fail("not_found");

  // Delete files **after the transaction succeeds**. Deleting them before a
  // rollback could leave a record whose file is missing.
  for (const filePath of filePaths) {
    await deleteStoredFile(filePath).catch((error: unknown) => {
      // The record is gone even if the file remains; log the orphan so
      // operations can clean it up.
      console.error(
        "[activity deletion] attachment could not be removed",
        JSON.stringify({ activityId, filePath, error: String(error) }),
      );
    });
  }

  return { ok: true, value: { deletedTitle: target.title } };
}
