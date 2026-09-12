import type { ApprovalReason, ApprovalReasonKind, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";


//




//



export type ApprovalReasonDb = Pick<
  PrismaClient,
  "approvalReason" | "auditLog" | "$transaction"
>;

export type ReasonErrorCode =
  | "not_found"
  | "duplicate_label"
  | "last_active_reason"
  | "unknown";

export type ReasonResult =
  | { ok: true; reason: ApprovalReason }
  | { ok: false; error: ReasonErrorCode; message: string };

const MESSAGES: Record<ReasonErrorCode, string> = {
  not_found: "Approval reason not found.",
  duplicate_label: "A reason with this label already exists for this decision type.",
  last_active_reason:
    "The last active reason for this decision type cannot be deactivated; create another one first.",
  unknown: "The approval reason could not be saved.",
};

function fail(error: ReasonErrorCode): ReasonResult {
  return { ok: false, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown): ReasonResult {



  // Map the unique constraint to a useful domain error (audit finding 11,
  // 23.08.2026).
  if (isUniqueViolation(error)) return fail("duplicate_label");
  return fail("unknown");
}


export async function listActiveReasons(
  db: Pick<PrismaClient, "approvalReason">,
  kind: ApprovalReasonKind,
): Promise<ApprovalReason[]> {
  return db.approvalReason.findMany({
    where: { kind, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}


export async function listAllReasons(
  db: Pick<PrismaClient, "approvalReason">,
): Promise<ApprovalReason[]> {
  return db.approvalReason.findMany({
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
}

export async function createReason(
  db: ApprovalReasonDb,
  input: { kind: ApprovalReasonKind; label: string; sortOrder: number },
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  try {
    const reason = await db.$transaction(async (tx) => {
      const created = await tx.approvalReason.create({
        data: { kind: input.kind, label: input.label, sortOrder: input.sortOrder },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: created.id,
        action: AUDIT_ACTIONS.approvalReasonCreated,
        detail: { kind: created.kind, label: created.label },
        now,
      });

      return created;
    });

    return { ok: true, reason };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function updateReason(
  db: ApprovalReasonDb,
  input: { id: string; label: string; sortOrder: number },
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  const existingReason = await db.approvalReason.findUnique({ where: { id: input.id } });
  if (!existingReason) return fail("not_found");

  try {
    const reason = await db.$transaction(async (tx) => {
      const current = await tx.approvalReason.update({
        where: { id: input.id },
        data: { label: input.label, sortOrder: input.sortOrder },
      });




      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: current.id,
        action: AUDIT_ACTIONS.approvalReasonUpdated,
        detail: {
          before: { label: existingReason.label, sortOrder: existingReason.sortOrder },
          after: { label: current.label, sortOrder: current.sortOrder },
        },
        now,
      });

      return current;
    });

    return { ok: true, reason };
  } catch (error) {
    return translateDatabaseError(error);
  }
}


export async function setReasonActive(
  db: ApprovalReasonDb,
  id: string,
  isActive: boolean,
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  const existingReason = await db.approvalReason.findUnique({ where: { id } });
  if (!existingReason) return fail("not_found");





  if (!isActive && existingReason.isActive) {
    const remaining = await db.approvalReason.count({
      where: { kind: existingReason.kind, isActive: true, id: { not: id } },
    });
    if (remaining === 0) return fail("last_active_reason");
  }

  try {
    const reason = await db.$transaction(async (tx) => {
      const current = await tx.approvalReason.update({
        where: { id },
        data: { isActive },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: id,
        action: isActive
          ? AUDIT_ACTIONS.approvalReasonActivated
          : AUDIT_ACTIONS.approvalReasonDeactivated,
        detail: { kind: current.kind, label: current.label },
        now,
      });

      return current;
    });

    return { ok: true, reason };
  } catch (error) {


    if (hasDatabaseSentinel(error, "LAST_APPROVAL_REASON")) {
      return fail("last_active_reason");
    }
    throw error;
  }
}
