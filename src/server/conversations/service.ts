import type { Conversation, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import {
  activityMaintenanceReader,
  lockActivityForMaintenance,
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { canViewActivity, type VisibilityDb } from "@/server/authz/visibility";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { isInManagementChain } from "@/server/org/chain";
import { touchFollowUps } from "@/server/follow-ups/service";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";

import { decideClose, type CloseRefusal } from "./close-rules";

// Question-answer cycle (§9) — platform's core value proposition.
//
// Multiple independent conversations can exist on a single activity (§9.1).
// Each conversation has a single responsible party: who holds the ball is always clear.
// A reply only advances the conversation it belongs to.

export type ConversationDb = Pick<
  PrismaClient,
  | "conversation"
  | "conversationMessage"
  | "notificationQueue"
  | "user"
  | "orgUnit"
  | "$transaction"
  | "workCalendar"
  | "holiday"
  | "systemSetting"
  | "auditLog"
> & ActivityRepositoryDb & VisibilityDb;

export interface Actor {
  id: string;
  isSystemAdmin: boolean;
}

export type ConversationError =
  | "activity_not_found"
  | "cannot_ask"
  | "conversation_not_found"
  | "not_a_party"
  | "closed"
  | CloseRefusal;

export type ConversationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConversationError; message: string };

const MESSAGES: Record<ConversationError, string> = {
  // Non-visible activity existence is never disclosed (§18.4).
  activity_not_found: "Activity not found.",
  cannot_ask: "You cannot ask questions on this activity.",
  conversation_not_found: "Conversation not found.",
  not_a_party: "You cannot participate in this conversation.",
  closed: "This conversation is closed.",
  responsible_cannot_close:
    "The person responsible for the question cannot close the conversation; reply instead, closing decision belongs to the asker.",
  supervisor_too_early:
    "You cannot close this conversation yet; you may intervene if the asker has been inactive for an extended period.",
  reason_required: "A closing reason must be provided.",
  already_closed: "This conversation is already closed.",
};

function fail(
  error: ConversationError,
): { ok: false; error: ConversationError; message: string } {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * Loads conversation verifying current activity visibility.
 *
 * Knowing conversation ID does not grant authorization. Visibility is computed
 * from current tree (§4.6) — a user transferred to another branch cannot continue
 * participating in old conversations (audit 18.08.2026, finding 1).
 */
async function loadVisibleConversation(
  db: ConversationDb,
  actor: Actor,
  conversationId: string,
  /**
   * Admin closure by system admin does not require content access (§9.3, §15.1).
   * Only permitted in closing path, never in writing paths.
   */
  options: { allowSystemAdminWithoutContent?: boolean } = {},
) {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      activityId: true,
      askerId: true,
      status: true,
      openedAt: true,
      activity: { select: { id: true, authorId: true, approvalStatus: true } },
      asker: { select: { isActive: true } },
    },
  });

  if (!conversation) return null;

  if (options.allowSystemAdminWithoutContent && actor.isSystemAdmin) {
    return conversation;
  }

  const level = await canViewActivity(db, actor, conversation.activity);
  if (level !== "full") return null;

  return conversation;
}

/**
 * Permission to ask question (§9.2): management chain with full visibility.
 * The author cannot ask question on their own activity.
 */
export async function canAskQuestion(
  db: ConversationDb,
  actor: Actor,
  activity: { id: string; authorId: string; approvalStatus: "APPROVED" | string },
): Promise<boolean> {
  if (activity.authorId === actor.id) return false;

  const level = await canViewActivity(db, actor, {
    id: activity.id,
    authorId: activity.authorId,
    approvalStatus: activity.approvalStatus as never,
  });

  return level === "full";
}

export async function askQuestion(
  db: ConversationDb,
  actor: Actor,
  input: { activityId: string; text: string },
  now: Date,
): Promise<ConversationResult<Conversation>> {
  const activity = await findVisibleActivity(db, actor, {
    where: { id: input.activityId },
    select: { id: true, authorId: true, approvalStatus: true, title: true },
  });

  if (!activity) return fail("activity_not_found");

  if (!(await canAskQuestion(db, actor, activity))) return fail("cannot_ask");

  const conversation = await db.$transaction(async (tx) => {
    // Activity row is locked to prevent race condition between cancel and question creation.
    await lockActivityForMaintenance(tx, activity.id);

    const fresh = await activityMaintenanceReader(tx).findUnique({
      where: { id: activity.id },
      select: { approvalStatus: true },
    });

    if (!fresh || fresh.approvalStatus !== "APPROVED") return null;

    const created = await tx.conversation.create({
      data: {
        activityId: activity.id,
        askerId: actor.id,
        // Responsible party is activity author: enters author's work queue (§9.2).
        responsibleId: activity.authorId,
        openedAt: now,
      },
    });

    await tx.conversationMessage.create({
      data: {
        conversationId: created.id,
        authorId: actor.id,
        text: input.text,
        createdAt: now,
      },
    });

    // Activity saw movement: open follow-up inactivity counter resets (§11.1).
    await touchFollowUps(tx, activity.id, actor.id, now);

    await enqueueNotification(tx, {
      userId: activity.authorId,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: activity.id, conversationId: created.id },
      idempotencyKey: `question_asked:${created.id}`,
      now,
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.conversation,
      objectId: created.id,
      action: AUDIT_ACTIONS.conversationOpened,
      detail: { activityId: activity.id },
      now,
    });

    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.questionAsked,
      userIds: [activity.authorId, actor.id],
    });

    return created;
  });

  if (conversation === null) return fail("activity_not_found");

  return { ok: true, value: conversation };
}

/**
 * Message reply (§9.2). Responsibility shifts to counterpart with each message.
 * No round limit (§9.4).
 */
export async function replyToConversation(
  db: ConversationDb,
  actor: Actor,
  input: { conversationId: string; text: string },
  now: Date,
): Promise<ConversationResult<Conversation>> {
  const conversation = await loadVisibleConversation(db, actor, input.conversationId);

  if (!conversation) return fail("conversation_not_found");

  // Parties are fixed: asker and author of activity.
  const respondentId = conversation.activity.authorId;
  const isParty = conversation.askerId === actor.id || respondentId === actor.id;
  if (!isParty) return fail("conversation_not_found");
  if (conversation.status === "CLOSED") return fail("closed");

  const counterpartId =
    actor.id === conversation.askerId ? respondentId : conversation.askerId;

  const updated = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversation.id} FOR UPDATE`;

    const fresh = await tx.conversation.findUnique({
      where: { id: conversation.id },
      select: { status: true },
    });

    if (!fresh || fresh.status !== "OPEN") return null;

    const message = await tx.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: actor.id,
        text: input.text,
        createdAt: now,
      },
    });

    await touchFollowUps(tx, conversation.activityId, actor.id, now);

    const next = await tx.conversation.update({
      where: { id: conversation.id },
      data: { responsibleId: counterpartId },
    });

    await enqueueNotification(tx, {
      userId: counterpartId,
      eventType:
        actor.id === conversation.askerId
          ? NOTIFICATION_EVENTS.questionAsked
          : NOTIFICATION_EVENTS.answerReceived,
      payload: {
        activityId: conversation.activityId,
        conversationId: conversation.id,
      },
      idempotencyKey: `conversation_message:${message.id}`,
      now,
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.conversation,
      objectId: conversation.id,
      action: AUDIT_ACTIONS.conversationReplied,
      detail: { messageId: message.id, activityId: conversation.activityId },
      now,
    });

    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.answerReceived,
      userIds: [counterpartId, actor.id],
    });

    return next;
  });

  if (updated === null) return fail("closed");

  return { ok: true, value: updated };
}

export async function closeConversation(
  db: ConversationDb,
  actor: Actor,
  conversationId: string,
  now: Date,
  /** Mandatory for administrative close; ignored in other modes (§9.3). */
  reason?: string,
): Promise<ConversationResult<Conversation>> {
  const conversation = await loadVisibleConversation(db, actor, conversationId, {
    allowSystemAdminWithoutContent: true,
  });
  if (!conversation) return fail("conversation_not_found");

  const lastAskerMessage = await db.conversationMessage.findFirst({
    where: { conversationId, authorId: conversation.askerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const respondentId = conversation.activity.authorId;

  const respondent = await db.user.findUnique({
    where: { id: respondentId },
    select: { isActive: true },
  });

  const [workCalendar, supervisorTakeoverDays] = await Promise.all([
    loadWorkCalendar(db, conversation.openedAt, now),
    readNumericSetting(db, SETTING_KEYS.supervisorTakeoverBusinessDays),
  ]);

  const decision = decideClose({
    status: conversation.status,
    askerId: conversation.askerId,
    respondentId,
    openedAt: conversation.openedAt,
    lastAskerActionAt: lastAskerMessage?.createdAt ?? conversation.openedAt,
    now,
    actorId: actor.id,
    actorIsSystemAdmin: actor.isSystemAdmin,
    actorIsAskerSupervisor: await isInManagementChain(
      db,
      conversation.askerId,
      actor.id,
    ),
    anyPartyInactive:
      !conversation.asker.isActive || respondent?.isActive === false,
    workingDays: workCalendar.workingDays,
    holidays: workCalendar.holidays,
    supervisorTakeoverDays,
  });

  if (!decision.allowed) return fail(decision.reason);

  const trimmedReason = reason?.trim() ?? "";
  if (decision.requiresReason && trimmedReason === "") {
    return fail("reason_required");
  }
  const closeReason = decision.requiresReason ? trimmedReason : null;

  const closed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;

    const fresh = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true },
    });

    if (!fresh || fresh.status !== "OPEN") return null;

    const closedConversation = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: "CLOSED",
        closedAt: now,
        closedById: actor.id,
        closeType: decision.closeType,
        closeReason,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.conversation,
      objectId: conversationId,
      action: AUDIT_ACTIONS.conversationClosed,
      detail: { closeType: decision.closeType },
      now,
    });

    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.conversationClosed,
      userIds: [conversation.askerId, respondentId, actor.id],
    });

    return closedConversation;
  });

  if (closed === null) return fail("already_closed");

  return { ok: true, value: closed };
}
