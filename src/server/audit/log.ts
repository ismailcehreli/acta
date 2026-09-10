import type { Prisma, PrismaClient } from "@prisma/client";

// Denetim izi (§15.2). Sayılan işlemler **değişmez** kayıt bırakır: kaydın
// güncellenmesi ve silinmesi veritabanı triggerlarıyla engelli
// (`AuditLog_no_update`, `AuditLog_no_delete`).
//
// Okuma verisi kapsam dışıdır (§10.3): kimin neye baktığı denetim izine
// girmez — okundu bilgisi bir kolaylık göstergesidir, adli kayıt değil.
//
// **Kayıt içerik taşımaz.** Faaliyet başlığı, açıklaması, iptal gerekçesi ve
// mesaj metni `detail` alanına yazılmaz. Sebebi §15.1: denetim izini sistem
// yöneticisi görür, ama sistem yöneticisinin içeriğe erişimi yoktur. İçerik
// yazılsaydı denetim ekranı görünürlük katmanını atlayan bir okuma yolu
// olurdu. `detail` yalnızca kimlik, sayı, durum ve yapılandırma değeri taşır.
//
// Kayıt, işin **kendi işlemi içinde** yazılır. Ayrı yazılsaydı "faaliyet
// kaydedildi ama izi yok" durumu mümkün olurdu; §15.2'nin istediği şey tam
// olarak bunun olmamasıdır.
//
// Sürüm 2'ye ait işlemler (onaylama, düzeltme talebi, yukarı taşıma, takip
// maddesi) burada bilerek yoktur (§18.2).

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
  // Faaliyet (§5)
  activityCreated: "activity_created",
  activityRevised: "activity_revised",
  activityCancelled: "activity_cancelled",
  activitySubmitted: "activity_submitted",
  activityApproved: "activity_approved",
  activityChangesRequested: "activity_changes_requested",
  activityRejected: "activity_rejected",
  // Root'un faaliyet silmesi (§16.5 istisnası, karar 03.09.2026). Silinen
  // kaydın izi burada kalır: `objectId` yabancı anahtar değil.
  activityDeletionRequested: "activity_deletion_requested",
  activityDeleted: "activity_deleted",
  // Konuşma (§9)
  conversationOpened: "conversation_opened",
  conversationReplied: "conversation_replied",
  conversationClosed: "conversation_closed",
  // Kullanıcı ve yetki (§4.6, §15.1)
  userCreated: "user_created",
  userUpdated: "user_updated",
  userDeactivated: "user_deactivated",
  userReactivated: "user_reactivated",
  userPasswordSet: "user_password_set",
  userPasswordChanged: "user_password_changed",
  notificationModeChanged: "notification_mode_changed",
  // "Faaliyet beklenmiyor" dönemi ve vekâlet (§4.5, §12.1). Vekil atamak bir
  // yetki devridir; verilmesi de geri alınması da iz bırakır.
  absenceMarked: "absence_marked",
  absenceCancelled: "absence_cancelled",
  absenceRequestSubmitted: "absence_request_submitted",
  absenceRequestApproved: "absence_request_approved",
  absenceRequestRejected: "absence_request_rejected",
  absenceRequestWithdrawn: "absence_request_withdrawn",
  userPasswordReset: "user_password_reset",
  // Organizasyon ağacı (§4.2)
  orgUnitCreated: "org_unit_created",
  orgUnitUpdated: "org_unit_updated",
  orgUnitMoved: "org_unit_moved",
  orgUnitDeactivated: "org_unit_deactivated",
  orgUnitReactivated: "org_unit_reactivated",
  // Onay gerekçe kataloğu (§5.4)
  approvalReasonCreated: "approval_reason_created",
  approvalReasonUpdated: "approval_reason_updated",
  approvalReasonActivated: "approval_reason_activated",
  approvalReasonDeactivated: "approval_reason_deactivated",
  // Web push (§12.3)
  pushKeysCreated: "push_keys_created",
  pushKeysReplaced: "push_keys_replaced",
  pushSubscribed: "push_subscribed",
  pushUnsubscribed: "push_unsubscribed",
  // Takip maddeleri (§11)
  followUpOpened: "follow_up_opened",
  followUpClosed: "follow_up_closed",
  followUpReopened: "follow_up_reopened",
  followUpTransferred: "follow_up_transferred",
  // Ayarlar (§16.5)
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
  /// Örnek veri temizliği (§22.3). Geri alınamaz bir işlem; izi şart.
  demoDataPurged: "demo_data_purged",
  /// Eski örnek kurulumundaki birimlerin kökeni yönetici tarafından karara bağlandı.
  demoOriginClassified: "demo_origin_classified",
  // Yardım kütüphanesi
  helpArticleCreated: "help_article_created",
  helpArticleUpdated: "help_article_updated",
  helpArticleArchived: "help_article_archived",
  feedbackCreated: "feedback_created",
  feedbackUpdated: "feedback_updated",
  feedbackArchived: "feedback_archived",
  // Oturum (§15.3)
  loginSucceeded: "login_succeeded",
  loginFailed: "login_failed",
  loginLocked: "login_locked",
} as const;

export type AuditObject = (typeof AUDIT_OBJECTS)[keyof typeof AUDIT_OBJECTS];
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditDb = Pick<PrismaClient, "auditLog">;

export interface AuditEntry {
  /**
   * İşlemi **fiilen yapan** kişi; oturum açma denemelerinde bilinmeyebilir.
   *
   * Vekâletle yapılan işlemde de burası vekildir — yani izi bırakan, tuşa
   * basan kişi. Bütün sorgular bu alanı "aktör" sayıyor ve anlamının
   * vekâlette değişmesi, o sorguların hepsini sessizce yanlışlar.
   */
  userId: string | null;
  /**
   * Vekâletle yapılan işlemde **adına** iş yapılan kişi (§4.5).
   *
   * Ekranda "Ahmet Yılmaz · İsmail Cehreli adına" diye okunur. Vekâlet yoksa
   * boştur.
   */
  actualUserId?: string | null;
  objectType: AuditObject;
  objectId: string;
  action: AuditAction;
  detail?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  now: Date;
}

/**
 * Denetim kaydı yazar. **Hata yutulmaz**: kayıt yazılamıyorsa çağıran işlem de
 * başarısız olur. "İz bırakmadan iş yapıldı" durumu, izin hiç olmamasından
 * daha kötüdür — kimse eksikliği fark etmez.
 */
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

/**
 * Denetim kayıtlarını okur. Görünürlük süzgeci **yoktur ve gerekmez**: kayıtlar
 * içerik taşımaz ve ekran yalnızca sistem yöneticisine açıktır (§15.1, §15.2).
 */
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

  const guvenliSayfa = Math.max(1, Math.trunc(page));

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (guvenliSayfa - 1) * pageSize,
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
    page: guvenliSayfa,
    pageCount: Math.ceil(total / pageSize),
  };
}
