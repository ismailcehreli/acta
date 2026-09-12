import type { Activity, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  attachmentMaintenanceReader,
  lockActivityForMaintenance,
} from "@/server/authz/activity-repository";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";
import { activeDeputiesOfMany } from "@/server/authz/deputy";
import { managementChain } from "@/server/org/chain";
import {
  acquireScoreMutationLock,
  enqueueScoreRecalculation,
} from "@/server/scoring/recalculation";
import {
  activityAttachmentData,
  cleanupStoredFiles,
  readAttachmentLimits,
  storeValidatedFiles,
  validateIncomingFiles,
  type IncomingFile,
  type StoredAttachmentFile,
} from "@/server/attachments/service";
import {
  ATTACHMENT_MESSAGES,
  checkAttachmentCount,
  type AttachmentRefusal,
} from "@/server/attachments/rules";

import { resolveInitialApproval } from "./approval";
import { openApprovalRound } from "./approval-rounds";
import { lockDraftForMaintenance } from "./draft-attachments";
import {
  checkActivityEditPermission,
  type ActivityEditRefusal,
} from "./edit-permission";

import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import type {
  CreateActivityInput,
  UpdateActivityInput,
} from "@/shared/schemas/activity";

import { checkActivityDate, companyDay, toDateValue } from "./date-rules";





export type ActivityWriteDb = Pick<
  PrismaClient,
  | "activity"
  | "approvalRound"
  | "activityApprover"
  | "activityRevision"
  | "activityTargetDept"
  | "attachment"
  | "activityDraft"
  | "activityDraftAttachment"
  | "orgUnit"
  | "user"
  | "readReceipt"
  | "systemSetting"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
  | "notificationQueue"
  | "noActivityPeriod"
  | "$transaction"
  | "$executeRawUnsafe"
  | "auditLog"
>;

export type ActivityWriteError =
  | "future_date"
  | "date_too_old"
  | "unknown_department"
  | "inactive_department"
  | "not_found"
  | "not_author"
  | "window_closed"
  | "already_read"
  | "cancelled"
  | "rejected"
  | "pending_approval"
  | "too_large"
  | "too_many"
  | "unsupported_type"
  | "empty_file"
  | "draft_not_found"
  | "conflict";

export type ActivityWriteResult =
  | { ok: true; activity: Activity }
  | { ok: false; error: ActivityWriteError; message: string };

const MESSAGES: Record<ActivityWriteError, string> = {
  future_date: "Activities cannot be entered for a future date.",
  date_too_old:
    "This date is outside the retroactive entry window. Only the last permitted days can be entered.",
  unknown_department: "One of the selected departments was not found.",
  inactive_department: "An inactive department cannot be selected as a related department.",



  not_found: "Activity not found.",
  not_author: "Activity not found.",
  window_closed:
    "The revision window has expired. An activity can only be revised for a short time after it is recorded.",
  already_read:
    "The activity has been read and can no longer be changed. Write a new activity if necessary.",
  cancelled: "A cancelled activity cannot be revised.",
  rejected:
    "A rejected activity cannot be revised. Write a new activity if necessary.",
  pending_approval:
    "The activity is awaiting approval; the revision window may be closed or the record may have been read.",
  too_large: ATTACHMENT_MESSAGES.too_large,
  too_many: ATTACHMENT_MESSAGES.too_many,
  unsupported_type: ATTACHMENT_MESSAGES.unsupported_type,
  empty_file: ATTACHMENT_MESSAGES.empty_file,
  draft_not_found: "Draft not found.",
  conflict:
    "The activity changed while you were working. Refresh the page and try again.",
};

function fail(error: ActivityWriteError): ActivityWriteResult {
  return { ok: false, error, message: MESSAGES[error] };
}

async function validateDepartments(
  db: ActivityWriteDb,
  ids: string[],
): Promise<ActivityWriteError | null> {
  const units = await db.orgUnit.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });

  if (units.length !== ids.length) return "unknown_department";
  if (units.some((unit) => !unit.isActive)) return "inactive_department";

  return null;
}

export interface ActivityAuthor {
  id: string;
  orgUnitId: string;

  requiresApproval: boolean;
}

export interface ActivityFileOptions {
  files?: IncomingFile[];

  draftId?: string;
}

class ActivityAttachmentLimitError extends Error {
  constructor(readonly refusal: AttachmentRefusal) {
    super(refusal);
    this.name = "ActivityAttachmentLimitError";
  }
}

class DraftSourceNotFoundError extends Error {
  constructor() {
    super("draft_not_found");
    this.name = "DraftSourceNotFoundError";
  }
}

class ActivityEditRefusalError extends Error {
  constructor(readonly refusal: ActivityEditRefusal) {
    super(refusal);
    this.name = "ActivityEditRefusalError";
  }
}

function attachmentFingerprint(file: { sha256: string; originalName: string }): string {
  return `${file.sha256}:${file.originalName}`;
}

function draftAttachmentData(
  activityId: string,
  uploaderId: string,
  file: {
    originalName: string;
    storedName: string;
    storagePath: string;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
  },
  now: Date,
) {
  return {
    activityId,
    originalName: file.originalName,
    storedName: file.storedName,
    storagePath: file.storagePath,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    sha256: file.sha256,
    uploadedById: uploaderId,
    createdAt: now,
  };
}

export async function createActivity(
  db: ActivityWriteDb,
  author: ActivityAuthor,
  input: CreateActivityInput,
  now: Date,
  options: ActivityFileOptions = {},
): Promise<ActivityWriteResult> {
  const retroactiveDays = await readNumericSetting(
    db,
    SETTING_KEYS.retroactiveEntryDays,
  );

  const dateProblem = checkActivityDate(input.activityDate, now, retroactiveDays);
  if (dateProblem === "future") return fail("future_date");
  if (dateProblem === "too_old") return fail("date_too_old");

  const departmentProblem = await validateDepartments(
    db,
    input.targetDepartmentIds,
  );
  if (departmentProblem) return fail(departmentProblem);

  // Resolve the initial status and approvers under §§5.4 and 4.4. Approvers
  // are stored at write time; recalculating them on every read would be
  // expensive and could silently reassign an activity after a tree change.
  const start = await resolveInitialApproval(db, author);

  const validated = await validateIncomingFiles(db, options.files ?? []);
  if (!validated.ok) return fail(validated.error);

  // If the transaction rolls back, newly stored files without rows are
  // cleaned up outside it. Files moved from a draft are excluded because
  // their rows and storage entries become activity attachments in the same transaction.
  let stored: StoredAttachmentFile[] = [];

  try {
    const activity = await db.$transaction(async (tx) => {
      // Acquire the score lock before writing any activity row so a concurrent
      // period closure cannot observe a mutation between the first revision
      // and its recalculation request.
      await acquireScoreMutationLock(tx);

      let draft: {
        id: string;
        attachments: {
          originalName: string;
          storedName: string;
          storagePath: string;
          sizeBytes: number;
          mimeType: string;
          sha256: string;
        }[];
      } | null = null;

      if (options.draftId) {
        await lockDraftForMaintenance(tx, options.draftId);
        draft = await tx.activityDraft.findFirst({
          where: { id: options.draftId, authorId: author.id },
          select: {
            id: true,
            attachments: {
              orderBy: { createdAt: "asc" },
              select: {
                originalName: true,
                storedName: true,
                storagePath: true,
                sizeBytes: true,
                mimeType: true,
                sha256: true,
              },
            },
          },
        });

        if (!draft) throw new DraftSourceNotFoundError();
      }

      const existingAttachments = draft?.attachments ?? [];
      const existingFingerprints = new Set(
        existingAttachments.map(attachmentFingerprint),
      );
      const nextFiles = validated.value.filter((file, index, all) => {
        const key = attachmentFingerprint(file);
        if (existingFingerprints.has(key)) return false;
        return all.findIndex((candidate) => attachmentFingerprint(candidate) === key) === index;
      });

      const limits = await readAttachmentLimits(tx);
      const countProblem = checkAttachmentCount(
        existingAttachments.length,
        nextFiles.length,
        limits,
      );
      if (countProblem) throw new ActivityAttachmentLimitError(countProblem);

      const created = await tx.activity.create({
        data: {
          authorId: author.id,
          // Freeze the unit at write time: later department changes must not
          // move the activity to a different reporting unit (§4.6).
          authorOrgUnitId: author.orgUnitId,
          activityDate: toDateValue(input.activityDate),
          title: input.title,
          description: input.description,
          approvalStatus: start.status,
          approverId: start.approverId,
          approvalSubmittedAt:
            start.status === "PENDING_APPROVAL" ? now : null,
          createdAt: now,
          updatedAt: now,
        },
      });

      // Open an approval turn when an approval-required record is submitted;
      // this preserves the submission instant used when the decision is made.
      if (created.approvalStatus === "PENDING_APPROVAL") {
        await openApprovalRound(tx, created.id, now);
      }

      await tx.activityTargetDept.createMany({
        data: input.targetDepartmentIds.map((orgUnitId) => ({
          activityId: created.id,
          orgUnitId,
        })),
      });

      // Every save creates an immutable revision (§5.5).
      await tx.activityRevision.create({
        data: {
          activityId: created.id,
          revisionNo: 1,
          title: created.title,
          description: created.description,
          targetOrgUnitIds: input.targetDepartmentIds,
          changedById: author.id,
          createdAt: now,
        },
      });

      stored = await storeValidatedFiles(nextFiles);
      for (const file of stored) {
        await tx.attachment.create({
          data: activityAttachmentData(created.id, author.id, file, now),
        });
      }

      if (draft) {
        for (const file of draft.attachments) {
          await tx.attachment.create({
            data: draftAttachmentData(created.id, author.id, file, now),
          });
        }

        // Draft attachment rows are consumed only in a successful submission
        // transaction; the storage files remain in place, so content is safe.
        await tx.$executeRawUnsafe("SET LOCAL app.activity_draft_promote = 'evet'");
        await tx.activityDraftAttachment.deleteMany({ where: { draftId: draft.id } });
        await tx.activityDraft.delete({ where: { id: draft.id } });
      }

    // A valid late entry into a frozen month does not change the old score;
    // it creates a new recalculation request in the same transaction. If the
    // queue row cannot be written, the activity write also fails.
    await enqueueScoreRecalculation(tx, {
      userId: author.id,
      activityDate: created.activityDate,
      sourceType: "ACTIVITY_CREATED",
      sourceId: created.id,
      now,
    });

    // Write the audit trail in the same transaction (§15.2), so a recorded
    // activity can never exist without its audit entry.
    await recordAudit(tx, {
      userId: author.id,
      objectType: AUDIT_OBJECTS.activity,
      objectId: created.id,
      action: AUDIT_ACTIONS.activityCreated,
      detail: {
        activityDate: input.activityDate,
        revisionNo: 1,
        approvalStatus: start.status,
      },
      now,
    });

    // Keep the scope feed live by notifying the higher chain that can see the
    // record. The event carries no content; a refresh obtains data through
    // the visibility module.
    const parentChain = await managementChain(tx, author.id);
    if (parentChain.length > 0) {
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.activityCreated,
        userIds: parentChain,
      });
    }

    if (start.status === "PENDING_APPROVAL") {
      // Eligible approvers are **stored on the record** and never derived
      // again, so moving a unit cannot silently reassign a pending activity.
      await tx.activityApprover.createMany({
        data: start.approverIds.map((userId) => ({
          activityId: created.id,
          userId,
        })),
        skipDuplicates: true,
      });

      // Notify active deputies as well; otherwise they would see delegated
      // work only after manually opening the screen (§4.5).
      const deputyIds = await activeDeputiesOfMany(tx, start.approverIds, now);
      const notificationRecipients = [
        ...new Set([...start.approverIds, ...deputyIds]),
      ];

      for (const approverId of notificationRecipients) {
        await enqueueNotification(tx, {
          userId: approverId,
          eventType: NOTIFICATION_EVENTS.approvalPending,
          payload: { activityId: created.id, activityTitle: created.title },
          // Include the approver in the key so each approver receives its own
          // notification in a dual-manager unit.
          idempotencyKey: `approval_pending:${created.id}:${approverId}`,
          now,
        });
      }

      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalPending,
        userIds: notificationRecipients,
      });
    }

    // A record without a manager does not wait silently: alert a system
    // administrator (§4.4). The record remains available in its error state.
    if (start.status === "MANAGER_NOT_FOUND") {
      const administrators = await tx.user.findMany({
        where: { isSystemAdmin: true, isActive: true },
        select: { id: true },
      });

      for (const admin of administrators) {
        await enqueueNotification(tx, {
          userId: admin.id,
          eventType: NOTIFICATION_EVENTS.managerNotFound,
          payload: { activityId: created.id },
          idempotencyKey: `manager_not_found:${created.id}:${admin.id}`,
          now,
        });
      }
    }

      return created;
    });

    return { ok: true, activity };
  } catch (error) {
    if (stored.length > 0) await cleanupStoredFiles(stored);

    if (error instanceof ActivityAttachmentLimitError) return fail(error.refusal);
    if (error instanceof DraftSourceNotFoundError) return fail("draft_not_found");

    throw error;
  }
}

export async function updateActivity(
  db: ActivityWriteDb,
  authorId: string,
  input: UpdateActivityInput,
  now: Date,
  options: ActivityFileOptions = {},
): Promise<ActivityWriteResult> {
  // Scope the query by author from the start. A record belonging to someone
  // else must be indistinguishable from a missing record.
  const activity = await activityMaintenanceReader(db).findFirst({
    where: { id: input.id, authorId },
  });

  if (!activity) return fail("not_found");
  if (activity.approvalStatus === "CANCELLED") return fail("cancelled");
  // Rejection is a terminal state: allowing a revision would make it
  // indistinguishable from a changes-requested record.
  if (activity.approvalStatus === "REJECTED") return fail("rejected");

  // A changes-requested record does not wait for the revision window. Pending
  // and approved records can be revised within the administrator-configured
  // window, provided nobody has read them (§5.5, §8.2).
  const changesRequested = activity.approvalStatus === "CHANGES_REQUESTED";
  const leave = await checkActivityEditPermission(db, authorId, activity, now);
  if (!leave.allowed) {
    if (leave.reason === "already_read") return fail("already_read");
    if (leave.reason === "window_closed") return fail("window_closed");
    return fail("conflict");
  }

  const retroactiveDays = await readNumericSetting(
    db,
    SETTING_KEYS.retroactiveEntryDays,
  );
  const dateProblem = checkActivityDate(input.activityDate, now, retroactiveDays);
  if (dateProblem === "future") return fail("future_date");
  // When the original activity date is preserved during a revision, the
  // retroactive limit is not rechecked. It applies only when a new past date
  // is selected.
  const isDateChanged = companyDay(activity.activityDate) !== input.activityDate;
  if (isDateChanged && dateProblem === "too_old") return fail("date_too_old");

  const departmentProblem = await validateDepartments(
    db,
    input.targetDepartmentIds,
  );
  if (departmentProblem) return fail(departmentProblem);

  const validated = await validateIncomingFiles(db, options.files ?? []);
  if (!validated.ok) return fail(validated.error);

  // If the transaction rolls back, newly uploaded files without rows are
  // cleaned up outside it. Existing activity attachments are untouched.
  let stored: StoredAttachmentFile[] = [];

  try {
    const updated = await db.$transaction(async (tx) => {
      await acquireScoreMutationLock(tx);

      // Lock and recheck the activity inside the transaction. A revision and
      // cancellation used to race, allowing a revision to change a cancelled
      // record after cancellation completed (audit finding 2, 18.08.2026).
      await lockActivityForMaintenance(tx, activity.id);

      const fresh = await activityMaintenanceReader(tx).findUnique({
        where: { id: activity.id },
        select: {
          id: true,
          approvalStatus: true,
          currentRevisionNo: true,
          createdAt: true,
        },
      });

      if (
        !fresh ||
        fresh.approvalStatus !== activity.approvalStatus ||
        fresh.currentRevisionNo !== activity.currentRevisionNo
      ) {
        return null;
      }

      // Reading and revision use the same activity lock. A decision therefore
      // uses the last read state under the lock; a later read cannot close the
      // revision window retroactively.
      const freshPermission = await checkActivityEditPermission(
        tx,
        authorId,
        fresh,
        now,
      );
      if (!freshPermission.allowed) {
        throw new ActivityEditRefusalError(freshPermission.reason);
      }

      const existingAttachments = await attachmentMaintenanceReader(tx).findMany({
        where: { activityId: activity.id },
        select: { sha256: true, originalName: true },
      });
      const existingFingerprints = new Set(
        existingAttachments.map(attachmentFingerprint),
      );
      const nextFiles = validated.value.filter((file, index, all) => {
        const key = attachmentFingerprint(file);
        if (existingFingerprints.has(key)) return false;
        return all.findIndex((candidate) => attachmentFingerprint(candidate) === key) === index;
      });
      const limits = await readAttachmentLimits(tx);
      const countProblem = checkAttachmentCount(
        existingAttachments.length,
        nextFiles.length,
        limits,
      );
      if (countProblem) throw new ActivityAttachmentLimitError(countProblem);

      const next = await tx.activity.update({
        where: { id: activity.id },
        data: {
          activityDate: toDateValue(input.activityDate),
          title: input.title,
          description: input.description,
          currentRevisionNo: activity.currentRevisionNo + 1,
          updatedAt: now,
          // Saving a revision returns the activity to the manager (§5.4):
          // changes requested → pending approval. Clear the reason; the
          // database constraint also prevents it in any other status.
          ...(changesRequested
            ? {
                approvalStatus: "PENDING_APPROVAL" as const,
                approvalReasonId: null,
                approvalReasonKind: null,
                approvalReasonNote: null,
                approvalDecidedAt: null,
                // Restart the timer: the activity is now with the manager again.
                approvalSubmittedAt: now,
              }
            : {}),
        },
      });

      stored = await storeValidatedFiles(nextFiles);
      for (const file of stored) {
        await tx.attachment.create({
          data: activityAttachmentData(activity.id, authorId, file, now),
        });
      }

      // A resubmitted revision opens a **new turn**. A single-row design would
      // overwrite the first turn; one row per turn preserves each duration.
      if (changesRequested) {
        await openApprovalRound(tx, activity.id, now);
      }

      // Rebuild the related-department list; the revision keeps the historical
      // selection, so no past information is lost.
      await tx.activityTargetDept.deleteMany({ where: { activityId: activity.id } });
      await tx.activityTargetDept.createMany({
        data: input.targetDepartmentIds.map((orgUnitId) => ({
          activityId: activity.id,
          orgUnitId,
        })),
      });

      await tx.activityRevision.create({
        data: {
          activityId: activity.id,
          revisionNo: next.currentRevisionNo,
          title: next.title,
          description: next.description,
          targetOrgUnitIds: input.targetDepartmentIds,
          changedById: authorId,
          createdAt: now,
        },
      });

      // A revised record must appear unread again to other users, especially
      // when it was resubmitted after a manager requested changes. Clear old
      // read receipts.
      await tx.readReceipt.deleteMany({
        where: { activityId: activity.id },
      });

      // The date may move to another month: the old month loses the record and
      // the new month gains it. Recalculate an immutable version for both.
      await enqueueScoreRecalculation(tx, {
        userId: authorId,
        activityDate: activity.activityDate,
        sourceType: "ACTIVITY_REVISED_OLD_PERIOD",
        sourceId: `${activity.id}:${next.currentRevisionNo}`,
        now,
      });
      await enqueueScoreRecalculation(tx, {
        userId: authorId,
        activityDate: next.activityDate,
        sourceType: "ACTIVITY_REVISED_NEW_PERIOD",
        sourceId: `${activity.id}:${next.currentRevisionNo}`,
        now,
      });

      await recordAudit(tx, {
        userId: authorId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activity.id,
        action: AUDIT_ACTIONS.activityRevised,
        detail: {
          revisionNo: next.currentRevisionNo,
          attachmentCount: nextFiles.length,
        },
        now,
      });

      const approvers = await tx.activityApprover.findMany({
        where: { activityId: activity.id },
        select: { userId: true },
      });

      // Refresh the manager queue and open screens when a pending activity
      // changes. The current turn is preserved; only a changes-requested
      // record opens a new one. Deputies follow the initial notification rule.
      if (
        approvers.length > 0 &&
        (activity.approvalStatus === "PENDING_APPROVAL" || changesRequested)
      ) {
        const deputyIds = await activeDeputiesOfMany(
          tx,
          approvers.map((row) => row.userId),
          now,
        );
        const notificationRecipients = [
          ...new Set([...approvers.map((row) => row.userId), ...deputyIds]),
        ];

        for (const approverId of notificationRecipients) {
          await enqueueNotification(tx, {
            userId: approverId,
            eventType: NOTIFICATION_EVENTS.approvalPending,
            payload: { activityId: activity.id, activityTitle: next.title },
            idempotencyKey: `approval_pending:${activity.id}:rev:${next.currentRevisionNo}:${approverId}`,
            now,
          });
        }

        await publishRealtimeEvent(tx, {
          kind: REALTIME_EVENTS.approvalPending,
          userIds: notificationRecipients,
        });
      }

      return next;
    });

    if (updated === null) return fail("conflict");

    return { ok: true, activity: updated };
  } catch (error) {
    if (stored.length > 0) await cleanupStoredFiles(stored);

    if (error instanceof ActivityAttachmentLimitError) return fail(error.refusal);
    if (error instanceof ActivityEditRefusalError) {
      if (error.refusal === "already_read") return fail("already_read");
      if (error.refusal === "window_closed") return fail("window_closed");
      return fail("conflict");
    }

    throw error;
  }
}
