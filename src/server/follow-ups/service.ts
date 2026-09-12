import type { FollowUpItem, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";
import { isInManagementChain } from "@/server/org/chain";

// Follow-up items (§11).
//



//



export type FollowUpDb = Pick<
  PrismaClient,
  | "followUpItem"
  | "followUpItemEvent"
  | "activityApprover"
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "auditLog"
  | "$transaction"
  | "$executeRaw"
  | "$queryRaw"
> & ActivityRepositoryDb;

export type FollowUpError =
  | "activity_not_found"
  | "activity_closed"
  | "already_open"
  | "not_found"
  | "not_allowed"
  | "note_required"
  | "owner_cannot_see"
  | "wrong_status";

export type FollowUpResult =
  | { ok: true; item: FollowUpItem }
  | { ok: false; error: FollowUpError; message: string };

const MESSAGES: Record<FollowUpError, string> = {
  activity_not_found: "Activity not found.",
  activity_closed: "A follow-up cannot be opened for a cancelled or rejected activity.",
  already_open: "This activity already has an open follow-up item.",
  not_found: "Follow-up item not found.",
  not_allowed: "You are not authorized to perform this action.",
  note_required: "A closing note is required.",
  owner_cannot_see: "The selected person cannot see this activity and cannot own its follow-up.",
  wrong_status: "The follow-up item is not in the required status.",
};

function fail(error: FollowUpError): FollowUpResult {
  return { ok: false, error, message: MESSAGES[error] };
}


async function canSee(db: FollowUpDb, viewer: Viewer, activityId: string) {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true, authorId: true, approvalStatus: true },
  });
  return activity;
}

export interface OpenFollowUpInput {
  activityId: string;
  nextStep?: string | null;
  reviewDate?: Date | null;

  ownerId?: string | null;
}

export async function openFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  input: OpenFollowUpInput,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const activity = await canSee(db, actor, input.activityId);
  if (!activity) return fail("activity_not_found");



  if (activity.approvalStatus === "CANCELLED" || activity.approvalStatus === "REJECTED") {
    return fail("activity_closed");
  }

  const ownerId = input.ownerId ?? actor.id;
  if (ownerId !== actor.id) {
    const canSeeOwner = await canSee(
      db,
      { id: ownerId, isSystemAdmin: false },
      input.activityId,
    );
    if (!canSeeOwner) return fail("owner_cannot_see");
  }

  const hasOpenItems = await db.followUpItem.count({
    where: { activityId: input.activityId, status: "OPEN" },
  });
  if (hasOpenItems > 0) return fail("already_open");

  const item = await db.$transaction(async (tx) => {
    const created = await tx.followUpItem.create({
      data: {
        activityId: input.activityId,
        openedById: actor.id,
        ownerId,
        openedAt: now,
        lastMovedAt: now,
        nextStep: input.nextStep?.trim() || null,
        reviewDate: input.reviewDate ?? null,
      },
    });

    await tx.followUpItemEvent.create({
      data: { followUpId: created.id, kind: "OPENED", actorId: actor.id, createdAt: now },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: created.id,
      action: AUDIT_ACTIONS.followUpOpened,

      detail: { activityId: input.activityId },
      now,
    });

    return created;
  });

  return { ok: true, item };
}


async function canManage(
  db: FollowUpDb,
  actor: Viewer,
  item: { ownerId: string; openedById: string },
): Promise<boolean> {
  if (actor.id === item.ownerId || actor.id === item.openedById) return true;
  return isInManagementChain(db, item.ownerId, actor.id);
}

export async function closeFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  note: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const reason = note.trim();
  if (reason === "") return fail("note_required");

  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "OPEN") return fail("wrong_status");

  const current = await db.$transaction(async (tx) => {






    await tx.$executeRaw`SELECT "id" FROM "FollowUpItem" WHERE "id" = ${followUpId} FOR UPDATE`;

    const fresh = await tx.followUpItem.findUnique({
      where: { id: followUpId },
      select: { status: true },
    });
    if (!fresh || fresh.status !== "OPEN") return null;

    const closed = await tx.followUpItem.update({
      where: { id: followUpId },
      data: {
        status: "CLOSED",
        closedById: actor.id,
        closedAt: now,
        closingNote: reason,
        lastMovedAt: now,
      },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "CLOSED",
        actorId: actor.id,
        note: reason,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpClosed,
      now,
    });

    return closed;
  });

  // A concurrent caller may have acquired the lock and closed the item first.
  if (!current) return fail("wrong_status");

  return { ok: true, item: current };
}

/** Reopening is allowed with a reason (§11.1). */
export async function reopenFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  note: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const reason = note.trim();
  if (reason === "") return fail("note_required");

  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "CLOSED") return fail("wrong_status");

  const hasOpenItems = await db.followUpItem.count({
    where: { activityId: item.activityId, status: "OPEN" },
  });
  if (hasOpenItems > 0) return fail("already_open");

  const current = await db.$transaction(async (tx) => {
    const open = await tx.followUpItem.update({
      where: { id: followUpId },
      data: {
        status: "OPEN",
        closedById: null,
        closedAt: null,
        closingNote: null,
        lastMovedAt: now,
      },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "REOPENED",
        actorId: actor.id,
        note: reason,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpReopened,
      now,
    });

    return open;
  });

  return { ok: true, item: current };
}

/** Transfer (§4.6): open work is transferred or closed before deactivation. */
export async function transferFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  newOwnerId: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "OPEN") return fail("wrong_status");

  // The new owner must be able to see the activity they are taking over.
  const canSeeActivity = await canSee(
    db,
    { id: newOwnerId, isSystemAdmin: false },
    item.activityId,
  );
  if (!canSeeActivity) return fail("owner_cannot_see");

  const current = await db.$transaction(async (tx) => {
    const transferredItem = await tx.followUpItem.update({
      where: { id: followUpId },
      data: { ownerId: newOwnerId, lastMovedAt: now },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "TRANSFERRED",
        actorId: actor.id,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpTransferred,
      detail: { newOwnerId },
      now,
    });

    return transferredItem;
  });

  return { ok: true, item: current };
}

/**
 * Touches follow-ups when an activity receives a comment or reply (§11.1).
 * Does nothing when the activity has no open item.
 */
export async function touchFollowUps(
  db: Pick<PrismaClient, "followUpItemEvent" | "$queryRaw">,
  activityId: string,
  /** Person who caused the movement: the asker or reply author. */
  actorId: string,
  now: Date,
): Promise<void> {
  // **One statement, one decision** (audit 23.08.2026, P3-R3-5).
  //
  // Read-then-write could fail in two ways: a delayed request could overwrite
  // a newer movement with an older `lastMovedAt`, and an item could close
  // between the read and the write. `GREATEST` keeps time monotonic, the
  // `WHERE status = 'OPEN'` clause moves the decision to write time, and
  // `RETURNING` reports only **actually updated** rows.
  const updatedItems = await db.$queryRaw<{ id: string }[]>`
    UPDATE "FollowUpItem"
    SET "lastMovedAt" = GREATEST("lastMovedAt", ${now}),
        "updatedAt" = GREATEST("updatedAt", ${now})
    WHERE "activityId" = ${activityId} AND "status" = 'OPEN'
    RETURNING "id"
  `;

  if (updatedItems.length === 0) return;

  // **Movement is also written to history** (P3-R2-3). `lastMovedAt` is a
  // current-state column that answers only "how stale is it now?"; it cannot
  // calculate a closed period. The event carries no content, but records
  // **who** moved it: the asker or reply author, not the item owner (P3-R3-4).
  await db.followUpItemEvent.createMany({
    data: updatedItems.map((item) => ({
      followUpId: item.id,
      kind: "TOUCHED" as const,
      actorId,
      createdAt: now,
    })),
  });
}

/**
 * Closes open items when an activity is cancelled (§5.5). The reason is
 * constant because the activity no longer exists as actionable work.
 */
export async function closeFollowUpsForCancelledActivity(
  db: Pick<PrismaClient, "followUpItem" | "followUpItemEvent">,
  activityId: string,
  actorId: string,
  now: Date,
): Promise<number> {
  const openItems = await db.followUpItem.findMany({
    where: { activityId, status: "OPEN" },
    select: { id: true },
  });

  for (const item of openItems) {
    await db.followUpItem.update({
      where: { id: item.id },
      data: {
        status: "CLOSED",
        closedById: actorId,
        closedAt: now,
        closingNote: "Activity cancelled.",
        lastMovedAt: now,
      },
    });

    await db.followUpItemEvent.create({
      data: {
        followUpId: item.id,
        kind: "CLOSED",
        actorId,
        note: "Activity cancelled.",
        createdAt: now,
      },
    });
  }

  return openItems.length;
}
