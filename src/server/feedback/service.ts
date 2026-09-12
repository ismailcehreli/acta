import type {
  FeedbackCategory,
  FeedbackStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  recordAudit,
  type AuditDb,
} from "@/server/audit/log";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

const HTML_TAG = /<\/?[a-z][^>]*>/i;

export type FeedbackReadDb = Pick<PrismaClient, "feedback">;
export type FeedbackDb = Pick<
  PrismaClient,
  "feedback" | "user" | "notificationQueue" | "systemSetting" | "$transaction"
> & AuditDb;

export interface FeedbackView {
  id: string;
  submittedById: string;
  submittedByName: string;
  submittedByUnitName: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  sourcePath: string | null;
  adminsOnly: boolean;
  status: FeedbackStatus;
  readAt: Date | null;
  readByName: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  response: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FeedbackCreateInput = {
  category: FeedbackCategory;
  title: string;
  description: string;
  sourcePath?: string | null;

  adminsOnly?: boolean;
};

export type FeedbackUpdateInput = {
  status: FeedbackStatus;
  response?: string | null;
};

export type FeedbackResult =
  | { ok: true; feedback: FeedbackView }
  | { ok: false; error: "invalid" | "not_found"; message: string };

const LIST_SELECT = {
  id: true,
  submittedById: true,
  category: true,
  title: true,
  description: true,
  sourcePath: true,
  adminsOnly: true,
  status: true,
  readAt: true,
  reviewedAt: true,
  resolvedAt: true,
  response: true,
  createdAt: true,
  updatedAt: true,
  submittedBy: {
    select: { fullName: true, orgUnit: { select: { name: true } } },
  },
  readBy: { select: { fullName: true } },
  reviewedBy: { select: { fullName: true } },
  resolvedBy: { select: { fullName: true } },
} satisfies Prisma.FeedbackSelect;

type FeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof LIST_SELECT }>;

function toView(row: FeedbackRow): FeedbackView {
  return {
    id: row.id,
    submittedById: row.submittedById,
    submittedByName: row.submittedBy.fullName,
    submittedByUnitName: row.submittedBy.orgUnit.name,
    category: row.category,
    title: row.title,
    description: row.description,
    sourcePath: row.sourcePath,
    adminsOnly: row.adminsOnly,
    status: row.status,
    readAt: row.readAt,
    readByName: row.readBy?.fullName ?? null,
    reviewedAt: row.reviewedAt,
    reviewedByName: row.reviewedBy?.fullName ?? null,
    resolvedAt: row.resolvedAt,
    resolvedByName: row.resolvedBy?.fullName ?? null,
    response: row.response,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeCreate(input: FeedbackCreateInput): FeedbackCreateInput | null {
  const title = input.title.trim();
  const description = input.description.replace(/\r\n?/g, "\n").trim();
  const sourcePath = input.sourcePath?.trim() || null;

  if (
    !title ||
    !description ||
    title.length > 200 ||
    description.length > 10000 ||
    (sourcePath !== null && sourcePath.length > 500) ||
    HTML_TAG.test(title) ||
    HTML_TAG.test(description) ||
    (sourcePath !== null && HTML_TAG.test(sourcePath))
  ) {
    return null;
  }

  return { ...input, title, description, sourcePath };
}

function normalizeResponse(value: string | null | undefined): string | null {
  if (!value) return null;
  const response = value.replace(/\r\n?/g, "\n").trim();
  if (!response || response.length > 5000 || HTML_TAG.test(response)) return null;
  return response;
}

async function managementWhere(
  db: Pick<PrismaClient, "user">,
  actorId: string,
): Promise<Prisma.FeedbackWhereInput | null> {
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { isActive: true, isSystemAdmin: true },
  });

  if (!actor?.isActive || !actor.isSystemAdmin) {
    return null;
  }

  return { archivedAt: null };
}

async function manageableFeedback(
  db: Pick<PrismaClient, "feedback" | "user">,
  actorId: string,
  feedbackId: string,
) {
  const scope = await managementWhere(db, actorId);
  if (!scope) return null;

  return db.feedback.findFirst({
    where: { id: feedbackId, ...scope },
    select: LIST_SELECT,
  });
}

export async function createFeedback(
  db: FeedbackDb,
  actorId: string,
  input: FeedbackCreateInput,
  now: Date = new Date(),
): Promise<FeedbackResult> {
  const normalized = normalizeCreate(input);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid",
      message: "The title and description must have valid lengths; HTML is not allowed.",
    };
  }

  const created = await db.$transaction(async (tx) => {
    const row = await tx.feedback.create({
      data: {
        ...normalized,
        adminsOnly: normalized.adminsOnly ?? false,
        submittedById: actorId,
        createdAt: now,
      },
      select: LIST_SELECT,
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.feedback,
      objectId: row.id,
      action: AUDIT_ACTIONS.feedbackCreated,
      detail: { category: row.category, adminsOnly: row.adminsOnly },
      now,
    });

    return row;
  });

  return { ok: true, feedback: toView(created) };
}

export async function listOwnFeedback(
  db: FeedbackReadDb,
  actorId: string,
): Promise<FeedbackView[]> {
  const rows = await db.feedback.findMany({
    where: { submittedById: actorId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
  });

  return rows.map(toView);
}

export async function listManageableFeedback(
  db: Pick<PrismaClient, "feedback" | "user">,
  actorId: string,
): Promise<FeedbackView[]> {
  const scope = await managementWhere(db, actorId);
  if (!scope) return [];

  const rows = await db.feedback.findMany({
    where: scope,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: LIST_SELECT,
  });

  return rows.map(toView);
}


export async function countManageableFeedback(
  db: Pick<PrismaClient, "feedback" | "user">,
  actorId: string,
): Promise<number> {
  const scope = await managementWhere(db, actorId);
  if (!scope) return 0;

  return db.feedback.count({
    where: { ...scope, status: "NEW" },
  });
}

export async function markFeedbackRead(
  db: FeedbackDb,
  actorId: string,
  feedbackId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.$transaction(async (tx) => {
    const row = await manageableFeedback(tx, actorId, feedbackId);
    if (!row) return { ok: false as const, message: "Feedback not found." };
    if (row.readAt) return { ok: true as const };

    await tx.feedback.update({
      where: { id: feedbackId },
      data: { readAt: now, readById: actorId },
    });

    return { ok: true as const };
  });
}

export async function archiveFeedback(
  db: FeedbackDb,
  actorId: string,
  feedbackId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.$transaction(async (tx) => {
    const existing = await manageableFeedback(tx, actorId, feedbackId);
    if (!existing) return { ok: false as const, message: "Feedback not found." };

    await tx.feedback.update({
      where: { id: feedbackId },
      data: { archivedAt: now },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.feedback,
      objectId: feedbackId,
      action: AUDIT_ACTIONS.feedbackArchived,
      detail: { status: existing.status },
      now,
    });

    return { ok: true as const };
  });
}

export async function updateFeedback(
  db: FeedbackDb,
  actorId: string,
  feedbackId: string,
  input: FeedbackUpdateInput,
  now: Date = new Date(),
): Promise<FeedbackResult> {
  const response =
    input.response === undefined ? undefined : normalizeResponse(input.response);
  if (input.response && response === null) {
    return {
      ok: false,
      error: "invalid",
      message: "A reply must not be empty, exceed 5,000 characters, or contain HTML.",
    };
  }

  return db.$transaction(async (tx) => {
    const existing = await manageableFeedback(tx, actorId, feedbackId);
    if (!existing) {
      return {
        ok: false as const,
        error: "not_found" as const,
        message: "Feedback not found.",
      };
    }

    const isInReview = input.status !== "NEW";
    const isResolved = input.status === "RESOLVED";
    const nextResponse = response === undefined ? existing.response : response;
    const statusChanged = existing.status !== input.status;
    const responseChanged = existing.response !== nextResponse;
    const updated = await tx.feedback.update({
      where: { id: feedbackId },
      data: {
        status: input.status,
        ...(response === undefined ? {} : { response }),
        readAt: existing.readAt ?? now,
        readById: existing.readBy ? undefined : actorId,
        reviewedAt: isInReview ? existing.reviewedAt ?? now : existing.reviewedAt,
        reviewedById: isInReview ? (existing.reviewedBy ? undefined : actorId) : undefined,
        resolvedAt: isResolved ? existing.resolvedAt ?? now : null,
        resolvedById: isResolved
          ? existing.resolvedBy
            ? undefined
            : actorId
          : null,
      },
      select: LIST_SELECT,
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.feedback,
      objectId: feedbackId,
      action: AUDIT_ACTIONS.feedbackUpdated,
      detail: {
        status: input.status,
        hasResponse: response !== null,
      },
      now,
    });

    if ((statusChanged || responseChanged) && existing.submittedById !== actorId) {
      await enqueueNotification(tx, {
        userId: existing.submittedById,
        eventType: NOTIFICATION_EVENTS.feedbackStatusChanged,
        payload: {
          feedbackTitle: updated.title,
          feedbackStatus: feedbackStatusLabel(updated.status),
        },
        idempotencyKey: `feedback_status:${feedbackId}:${updated.updatedAt.toISOString()}`,
        now,
      });
    }

    return { ok: true as const, feedback: toView(updated) };
  });
}

export function feedbackCategoryLabel(category: FeedbackCategory): string {
  switch (category) {
    case "BUG":
      return "Bug report";
    case "SUGGESTION":
      return "Suggestion";
    case "CRITIQUE":
      return "Criticism";
    case "QUESTION":
      return "Question";
  }
}

export function feedbackStatusLabel(status: FeedbackStatus): string {
  switch (status) {
    case "NEW":
      return "New";
    case "IN_REVIEW":
      return "In review";
    case "RESOLVED":
      return "Resolved";
  }
}
