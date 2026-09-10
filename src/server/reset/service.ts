import { isUniqueViolation } from "@/server/db-errors";
import type { PrismaClient, SystemResetStatus } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isEmailDomainAllowed } from "@/server/settings/email-domains";
import { readAllowedEmailDomains } from "@/server/settings/system-settings";
import { emailSchema, passwordSchema } from "@/shared/schemas/auth";
import { fullNameSchema } from "@/shared/schemas/user";

/**
 * Başlangıca dönüşün veritabanı tarafı.
 *
 * Web isteği yalnızca kuyruğa kayıt bırakır. Aşağıdaki ikinci işlem host
 * koşucusu tarafından, app ve worker durdurulmuşken çağrılır. Sıfırlama
 * transaction'ı kontrollü bir `TRUNCATE` kullanır; normal silme trigger'larını
 * aşan bu yolun tek çağrıcısı reset koşucusudur.
 */

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
  | { ok: false; error: ResetRequestError; message: string };

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

// Bu metin yalnız sabit tablo adlarından oluşur; kullanıcı girdisi hiçbir
// şekilde SQL'e katılmaz.
const RESET_SQL = `TRUNCATE TABLE ${RESET_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`;

const ACTIVE_REQUEST_MESSAGE =
  "Zaten bekleyen veya çalışan bir başlangıca dönüş işlemi var.";

function fail(error: ResetRequestError, message: string): ResetRequestResult {
  return { ok: false, error, message };
}

/** Web panelinin güvenlik ve tekillik sınırından geçen yeni istek. */
export async function requestSystemReset(
  db: ResetRequestDb,
  input: ResetRequestInput,
  now: Date = new Date(),
): Promise<ResetRequestResult> {
  const name = fullNameSchema.safeParse(input.bootstrapFullName);
  if (!name.success) return fail("unknown", name.error.issues[0]?.message ?? "Ad soyad geçersiz.");

  const email = emailSchema.safeParse(input.bootstrapEmail);
  if (!email.success) return fail("unknown", email.error.issues[0]?.message ?? "E-posta geçersiz.");

  const password = passwordSchema.safeParse(input.bootstrapPassword);
  if (!password.success) return fail("unknown", password.error.issues[0]?.message ?? "Parola geçersiz.");

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
    return fail("invalid_current_password", "Mevcut parolanız doğrulanamadı.");
  }

  if (!(await verifyPassword(actor.credential.passwordHash, input.currentPassword))) {
    return fail("invalid_current_password", "Mevcut parolanız doğrulanamadı.");
  }

  const allowedDomains = await readAllowedEmailDomains(db);
  if (!isEmailDomainAllowed(email.data, allowedDomains)) {
    return fail(
      "email_domain_not_allowed",
      `Başlangıç yöneticisi için şu alan adlarından birini kullanın: ${allowedDomains.join(", ") || "izin verilen bir alan adı"}.`,
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
    console.error("[başlangıca dönüş] istek oluşturulamadı", error);
    return fail("unknown", "Başlangıca dönüş isteği oluşturulamadı.");
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
 * Çalışan isteği tek transaction içinde yeni kök ve başlangıç yöneticisine
 * çevirir. Koşucu bu fonksiyonu app/worker durdurulduktan sonra çağırır.
 */
export async function resetApplicationData(
  db: PrismaClient,
  requestId: string,
  now: Date = new Date(),
): Promise<ResetRunResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:baslangica_donus'))`;

    const request = await tx.systemResetRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== "RUNNING") {
      throw new Error("Sıfırlama isteği çalışır durumda değil.");
    }
    if (!request.bootstrapPasswordHash) {
      throw new Error("Başlangıç yöneticisi parolası bulunamadı.");
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
        name: process.env.ROOT_UNIT_NAME ?? "Şirket",
        type: "Kök",
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
        title: "Sistem yöneticisi",
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

    // TRUNCATE ile istek satırı da temizlendi; aynı kimliği yeniden oluşturarak
    // panelin işlem sonucunu göstermeye devam etmesini sağlarız.
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
        message: "Uygulama başlangıç durumuna döndürüldü.",
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
