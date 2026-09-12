import { isUniqueViolation } from "@/server/db-errors";
import type { PrismaClient, SystemResetStatus } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isEmailDomainAllowed } from "@/server/settings/email-domains";
import { readAllowedEmailDomains } from "@/server/settings/system-settings";
import { emailSchema, passwordSchema } from "@/shared/schemas/auth";
import { fullNameSchema } from "@/shared/schemas/user";



export type ResetRequestDb = Pick<
  PrismaClient,
  | "user"
  | "systemResetRequest"
  | "systemSetting"
  | "auditLog"
  | "$transaction"
>;

export type ResetRequestError =
  | "invalid_current_password"
  | "email_domain_not_allowed"
  | "active_request"
  | "unknown";

export type ResetRequestResult =
  | { ok: true; requestId: string }
  | {
      ok: false;
      error: ResetRequestError;
      message: string;
      messageKey?: string;
      messageValues?: Record<string, string | number>;
    };

export interface ResetRequestInput {
  actorId: string;
  currentPassword: string;
  bootstrapFullName: string;
  bootstrapEmail: string;
  bootstrapPassword: string;
}

export interface ResetRequestView {
  id: string;
  status: SystemResetStatus;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  bootstrapFullName: string;
  bootstrapEmail: string;
  message: string | null;
}

const RESET_TABLES = [
  "ActivityAppreciation",
  "ActivityApprover",
  "ActivityRevision",
  "ActivityTargetDept",
  "Attachment",
  "CancellationRecord",
  "ConversationMessage",
  "ReadReceipt",
  "FollowUpItemEvent",
  "FollowUpItem",
  "ApprovalRound",
  "ActivityDraft",
  "NotificationQueue",
  "PushSubscription",
  "Conversation",
  "NoActivityPeriod",
  "Activity",
  "UserScorePeriodFact",
  "UserScorePeriod",
  "ScoreRecalculationRequest",
  "ScoreUserStateEvent",
  "ScoreOrgUnitStateEvent",
  "ScoreCompanyCalendarEvent",
  "ScoreUnitCalendarEvent",
  "ScoreHolidayEvent",
  "ScoreSettingEvent",
  "ScorePeriodLedger",
  "ScoreHistoryControl",
  "WorkCalendar",
  "OrgUnitWorkCalendar",
  "Holiday",
  "ScheduledJobStatus",
  "BackupRequest",
  "DemoObject",
  "HelpArticle",
  "Feedback",
  "ApprovalReason",
  "SystemSetting",
  "Session",
  "UserCredential",
  "AuditLog",
  "SystemResetRequest",
  "User",
  "OrgUnit",
] as const;



const RESET_SQL = `TRUNCATE TABLE ${RESET_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`;

const ACTIVE_REQUEST_MESSAGE =
  "A reset operation is already waiting or running.";

function fail(
  error: ResetRequestError,
  message: string,
  options: {
    messageKey?: string;
    messageValues?: Record<string, string | number>;
  } = {},
): ResetRequestResult {
  return { ok: false, error, message, ...options };
}


export async function requestSystemReset(
  db: ResetRequestDb,
  input: ResetRequestInput,
  now: Date = new Date(),
): Promise<ResetRequestResult> {
  const name = fullNameSchema.safeParse(input.bootstrapFullName);
  if (!name.success) return fail("unknown", name.error.issues[0]?.message ?? "Full name is invalid.");

  const email = emailSchema.safeParse(input.bootstrapEmail);
  if (!email.success) return fail("unknown", email.error.issues[0]?.message ?? "Email is invalid.");

  const password = passwordSchema.safeParse(input.bootstrapPassword);
  if (!password.success) return fail("unknown", password.error.issues[0]?.message ?? "Password is invalid.");

  const actor = await db.user.findUnique({
    where: { id: input.actorId },
    select: {
      id: true,
      isActive: true,
      isSystemAdmin: true,
      credential: { select: { passwordHash: true } },
    },
  });

  if (!actor?.isActive || !actor.isSystemAdmin || !actor.credential) {
    return fail("invalid_current_password", "Your current password could not be verified.");
  }

  if (!(await verifyPassword(actor.credential.passwordHash, input.currentPassword))) {
    return fail("invalid_current_password", "Your current password could not be verified.");
  }

  const allowedDomains = await readAllowedEmailDomains(db);
  if (!isEmailDomainAllowed(email.data, allowedDomains)) {
    return fail(
      "email_domain_not_allowed",
      `Use one of these email domains for the bootstrap administrator: ${allowedDomains.join(", ") || "an allowed domain"}.`,
      {
        messageKey: "errors.reset.emailDomainNotAllowed",
        messageValues: {
          domains: allowedDomains.join(", ") || "an allowed domain",
        },
      },
    );
  }

  const passwordHash = await hashPassword(password.data);

  try {
    const requestId = await db.$transaction(async (tx) => {
      const active = await tx.systemResetRequest.findFirst({
        where: { status: { in: ["PENDING", "RUNNING"] } },
        select: { id: true },
      });
      if (active) throw new ActiveResetRequestError();

      const request = await tx.systemResetRequest.create({
        data: {
          requestedById: actor.id,
          bootstrapFullName: name.data,
          bootstrapEmail: email.data,
          bootstrapPasswordHash: passwordHash,
          requestedAt: now,
        },
      });

      await recordAudit(tx, {
        userId: actor.id,
        objectType: AUDIT_OBJECTS.systemReset,
        objectId: request.id,
        action: AUDIT_ACTIONS.systemResetRequested,
        detail: {
          bootstrapFullName: request.bootstrapFullName,
          bootstrapEmail: request.bootstrapEmail,
        },
        now,
      });

      return request.id;
    });

    return { ok: true, requestId };
  } catch (error) {
    if (error instanceof ActiveResetRequestError || isUniqueViolation(error)) {
      return fail("active_request", ACTIVE_REQUEST_MESSAGE);
    }
    console.error("[application reset] request could not be created", error);
    return fail("unknown", "The application reset request could not be created.");
  }
}

class ActiveResetRequestError extends Error {}

export async function latestSystemResetRequest(
  db: Pick<PrismaClient, "systemResetRequest">,
): Promise<ResetRequestView | null> {
  return db.systemResetRequest.findFirst({
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      bootstrapFullName: true,
      bootstrapEmail: true,
      message: true,
    },
  });
}

export interface ResetRunResult {
  requestId: string;
  bootstrapUserId: string;
  rootUnitId: string;
}

/**
 * Converts a running request into a new root unit and bootstrap administrator
 * in one transaction. The runner calls this after the app and worker stop.
 */
export async function resetApplicationData(
  db: PrismaClient,
  requestId: string,
  now: Date = new Date(),
): Promise<ResetRunResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acta:application_reset'))`;

    const request = await tx.systemResetRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== "RUNNING") {
      throw new Error("The reset request is not running.");
    }
    if (!request.bootstrapPasswordHash) {
      throw new Error("The bootstrap administrator password is missing.");
    }

    const requestData = {
      id: request.id,
      requestedAt: request.requestedAt,
      bootstrapFullName: request.bootstrapFullName,
      bootstrapEmail: request.bootstrapEmail,
      bootstrapPasswordHash: request.bootstrapPasswordHash,
    };

    await tx.$executeRawUnsafe(RESET_SQL);

    const root = await tx.orgUnit.create({
      data: {
        name: process.env.ROOT_UNIT_NAME ?? "Company",
        type: "Root",
        parentId: null,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
    });

    const bootstrap = await tx.user.create({
      data: {
        fullName: requestData.bootstrapFullName,
        email: requestData.bootstrapEmail,
        title: "System administrator",
        orgUnitId: root.id,
        isUnitManager: true,
        isSystemAdmin: true,
        isRoot: true,
        canViewReports: true,
        canViewScoreReports: true,
        isScored: false,
        canAppreciate: false,
        writesActivities: false,
      },
    });

    await tx.userCredential.create({
      data: {
        userId: bootstrap.id,
        passwordHash: requestData.bootstrapPasswordHash,
        mustChangePassword: true,
        passwordChangedAt: now,
      },
    });

    // TRUNCATE also removes the request row, so recreate it with the same ID
    // to keep the operation result visible in the settings panel.
    const finished = await tx.systemResetRequest.create({
      data: {
        id: requestData.id,
        requestedById: null,
        status: "DONE",
        requestedAt: requestData.requestedAt,
        startedAt: request.startedAt ?? now,
        finishedAt: now,
        bootstrapFullName: requestData.bootstrapFullName,
        bootstrapEmail: requestData.bootstrapEmail,
        bootstrapPasswordHash: null,
        message: "Application reset completed.",
      },
    });

    await recordAudit(tx, {
      userId: bootstrap.id,
      objectType: AUDIT_OBJECTS.systemReset,
      objectId: finished.id,
      action: AUDIT_ACTIONS.systemResetCompleted,
      detail: { bootstrapUserId: bootstrap.id, rootUnitId: root.id },
      now,
    });

    return {
      requestId: finished.id,
      bootstrapUserId: bootstrap.id,
      rootUnitId: root.id,
    };
  });
}

export const RESET_TABLE_NAMES = RESET_TABLES;
