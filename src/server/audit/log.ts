import type { Prisma, PrismaClient } from "@prisma/client";



// (`AuditLog_no_update`, `AuditLog_no_delete`).
//


//





//



//

// Physical deletion is intentionally absent from this list (§18.2).

export const AUDIT_OBJECTS = {
  activity: "activity",
  conversation: "conversation",
  user: "user",
  orgUnit: "org_unit",
  setting: "setting",
  approvalReason: "approval_reason",
  followUp: "follow_up",
  session: "session",
  backupRequest: "backup_request",
  systemReset: "system_reset",
  helpArticle: "help_article",
  feedback: "feedback",
} as const;

export const AUDIT_ACTIONS = {
  // Activities (§5)
  activityCreated: "activity_created",
  activityRevised: "activity_revised",
  activityCancelled: "activity_cancelled",
  activitySubmitted: "activity_submitted",
  activityApproved: "activity_approved",
  activityChangesRequested: "activity_changes_requested",
  activityRejected: "activity_rejected",


  activityDeletionRequested: "activity_deletion_requested",
  activityDeleted: "activity_deleted",
  // Conversation (§9)
  conversationOpened: "conversation_opened",
  conversationReplied: "conversation_replied",
  conversationClosed: "conversation_closed",
  // Users and permissions (§4.6, §15.1)
  userCreated: "user_created",
  userUpdated: "user_updated",
  userDeactivated: "user_deactivated",
  userReactivated: "user_reactivated",
  userPasswordSet: "user_password_set",
  userPasswordChanged: "user_password_changed",
  notificationModeChanged: "notification_mode_changed",


  absenceMarked: "absence_marked",
  absenceCancelled: "absence_cancelled",
  absenceRequestSubmitted: "absence_request_submitted",
  absenceRequestApproved: "absence_request_approved",
  absenceRequestRejected: "absence_request_rejected",
  absenceRequestWithdrawn: "absence_request_withdrawn",
  userPasswordReset: "user_password_reset",

  orgUnitCreated: "org_unit_created",
  orgUnitUpdated: "org_unit_updated",
  orgUnitMoved: "org_unit_moved",
  orgUnitDeactivated: "org_unit_deactivated",
  orgUnitReactivated: "org_unit_reactivated",

  approvalReasonCreated: "approval_reason_created",
  approvalReasonUpdated: "approval_reason_updated",
  approvalReasonActivated: "approval_reason_activated",
  approvalReasonDeactivated: "approval_reason_deactivated",
  // Web push (§12.3)
  pushKeysCreated: "push_keys_created",
  pushKeysReplaced: "push_keys_replaced",
  pushSubscribed: "push_subscribed",
  pushUnsubscribed: "push_unsubscribed",
  // Follow-up items (§11)
  followUpOpened: "follow_up_opened",
  followUpClosed: "follow_up_closed",
  followUpReopened: "follow_up_reopened",
  followUpTransferred: "follow_up_transferred",
  // Settings (§16.5)
  settingsChanged: "settings_changed",
  workCalendarChanged: "work_calendar_changed",
  holidayAdded: "holiday_added",
  holidayRemoved: "holiday_removed",
  smtpChanged: "smtp_changed",
  smtpPasswordCleared: "smtp_password_cleared",
  backupRequested: "backup_requested",
  systemResetRequested: "system_reset_requested",
  systemResetCompleted: "system_reset_completed",
  systemResetFailed: "system_reset_failed",
  brandingChanged: "branding_changed",
  logoChanged: "logo_changed",
  logoRemoved: "logo_removed",
  scoreHistoryCorrected: "score_history_corrected",

  demoDataPurged: "demo_data_purged",

  demoOriginClassified: "demo_origin_classified",

  helpArticleCreated: "help_article_created",
  helpArticleUpdated: "help_article_updated",
  helpArticleArchived: "help_article_archived",
  feedbackCreated: "feedback_created",
  feedbackUpdated: "feedback_updated",
  feedbackArchived: "feedback_archived",
  // Sessions (§15.3)
  loginSucceeded: "login_succeeded",
  loginFailed: "login_failed",
  loginLocked: "login_locked",
} as const;

export type AuditObject = (typeof AUDIT_OBJECTS)[keyof typeof AUDIT_OBJECTS];
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditDb = Pick<PrismaClient, "auditLog">;

export interface AuditEntry {

  userId: string | null;

  actualUserId?: string | null;
  objectType: AuditObject;
  objectId: string;
  action: AuditAction;
  detail?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  now: Date;
}


export async function recordAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      actualUserId: entry.actualUserId ?? null,
      objectType: entry.objectType,
      objectId: entry.objectId,
      action: entry.action,
      detail: entry.detail,
      ipAddress: entry.ipAddress ?? null,
      createdAt: entry.now,
    },
  });
}

export interface AuditEntryView {
  id: string;
  createdAt: Date;
  userName: string | null;
  actualUserName: string | null;
  objectType: string;
  objectId: string;
  action: string;
  detail: unknown;
  ipAddress: string | null;
}

export interface AuditPage {
  entries: AuditEntryView[];
  total: number;
  page: number;
  pageCount: number;
}

export const AUDIT_PAGE_SIZE = 50;

export type AuditReadDb = Pick<PrismaClient, "auditLog">;


export async function listAuditEntries(
  db: AuditReadDb,
  filters: { objectType?: string; action?: string; userId?: string } = {},
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
): Promise<AuditPage> {
  const where = {
    ...(filters.objectType ? { objectType: filters.objectType } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
  };

  const safePage = Math.max(1, Math.trunc(page));

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        objectType: true,
        objectId: true,
        action: true,
        detail: true,
        ipAddress: true,
        user: { select: { fullName: true } },
        actualUser: { select: { fullName: true } },
      },
    }),
  ]);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      userName: row.user?.fullName ?? null,
      actualUserName: row.actualUser?.fullName ?? null,
      objectType: row.objectType,
      objectId: row.objectId,
      action: row.action,
      detail: row.detail,
      ipAddress: row.ipAddress,
    })),
    total,
    page: safePage,
    pageCount: Math.ceil(total / pageSize),
  };
}
