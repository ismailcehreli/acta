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

// Faaliyet yazma ve düzeltme (§5). Girişin hızlı olması ürünün can damarıdır
// (§18.6: 30 saniye ölçütü); bu yüzden burada tek bir işlem yapılır ve
// gereksiz sorgu atılmaz.

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
  future_date: "İleri tarihli faaliyet girilemez.",
  date_too_old:
    "Bu tarih geçmişe dönük giriş sınırının dışında. Yalnızca son günlerin faaliyeti girilebilir.",
  unknown_department: "Seçilen departmanlardan biri bulunamadı.",
  inactive_department: "Pasif bir departman muhatap olarak seçilemez.",
  // Yetkisiz erişim ile var olmayan kayıt **aynı** cevabı alır: farklı mesaj,
  // kaydın varlığını ve sahibini ele verirdi (denetim 18.08.2026,
  // bulgu 1). Ayrım yalnızca sunucu tarafında anlamlıdır.
  not_found: "Faaliyet bulunamadı.",
  not_author: "Faaliyet bulunamadı.",
  window_closed:
    "Düzeltme süresi doldu. Faaliyet kayıttan sonraki kısa süre içinde düzeltilebilir.",
  already_read:
    "Faaliyet okundu; artık değiştirilemez. Gerekiyorsa yeni bir faaliyet yazın.",
  cancelled: "İptal edilmiş faaliyet düzenlenemez.",
  rejected:
    "Reddedilen faaliyet düzenlenemez. Gerekiyorsa yeni bir faaliyet yazın.",
  pending_approval:
    "Faaliyet onay bekliyor; düzeltme penceresi kapanmış veya kayıt okunmuş olabilir.",
  too_large: ATTACHMENT_MESSAGES.too_large,
  too_many: ATTACHMENT_MESSAGES.too_many,
  unsupported_type: ATTACHMENT_MESSAGES.unsupported_type,
  empty_file: ATTACHMENT_MESSAGES.empty_file,
  draft_not_found: "Taslak bulunamadı.",
  conflict:
    "Faaliyet bu sırada değişti. Sayfayı yenileyip tekrar deneyin.",
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
  /** Yazarın biriminin onay bayrağı (§4.3). */
  requiresApproval: boolean;
}

export interface ActivityFileOptions {
  files?: IncomingFile[];
  /** Gönderim bir sunucu taslağından yapılıyorsa taslak kimliği. */
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

  // Kaydın hangi durumda doğacağı ve onaylayıcısının kim olduğu §5.4 ve §4.4
  // ile burada çözülür. Onaylayıcı **yazım anında** kayda yazılır: her listede
  // yeniden hesaplamak hem pahalı, hem de ağaç değişince akıştaki işi sessizce
  // başkasına devretmek olurdu.
  const baslangic = await resolveInitialApproval(db, author);

  const validated = await validateIncomingFiles(db, options.files ?? []);
  if (!validated.ok) return fail(validated.error);

  // Transaction geri alınırsa satırsız kalan yeni dosyalar dışarıda temizlenir.
  // Taslaktan taşınan dosyalar bu kümeye girmez; onların satırı ve dosyası
  // transaction içinde faaliyet ekine dönüşür.
  let stored: StoredAttachmentFile[] = [];

  try {
    const activity = await db.$transaction(async (tx) => {
      // Kapanış aynı anda başlarsa mutasyonun ilk sürüm ile düzeltme kuyruğu
      // arasından düşmemesi için herhangi bir faaliyet satırı yazmadan önce.
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

      const mevcutEkler = draft?.attachments ?? [];
      const mevcutParmakIzleri = new Set(mevcutEkler.map(attachmentFingerprint));
      const yeniDosyalar = validated.value.filter((file, index, all) => {
        const key = attachmentFingerprint(file);
        if (mevcutParmakIzleri.has(key)) return false;
        return all.findIndex((candidate) => attachmentFingerprint(candidate) === key) === index;
      });

      const limits = await readAttachmentLimits(tx);
      const countProblem = checkAttachmentCount(mevcutEkler.length, yeniDosyalar.length, limits);
      if (countProblem) throw new ActivityAttachmentLimitError(countProblem);

      const created = await tx.activity.create({
        data: {
          authorId: author.id,
          // Yazım anındaki birim dondurulur: kişi departman değiştirse de bu
          // faaliyet yazıldığı birimle raporlanır (§4.6).
          authorOrgUnitId: author.orgUnitId,
          activityDate: toDateValue(input.activityDate),
          title: input.title,
          description: input.description,
          approvalStatus: baslangic.status,
          approverId: baslangic.approverId,
          approvalSubmittedAt:
            baslangic.status === "PENDING_APPROVAL" ? now : null,
          createdAt: now,
          updatedAt: now,
        },
      });

      // Onaya tabi kayıt gönderildiği anda tur açılır: karar verilirken
      // gönderim anının kaybolmaması buna bağlı (P3-R2-1).
      if (created.approvalStatus === "PENDING_APPROVAL") {
        await openApprovalRound(tx, created.id, now);
      }

      await tx.activityTargetDept.createMany({
        data: input.targetDepartmentIds.map((orgUnitId) => ({
          activityId: created.id,
          orgUnitId,
        })),
      });

      // Her kaydetme değişmez bir revizyon üretir (§5.5).
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

      stored = await storeValidatedFiles(yeniDosyalar);
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

        // Taslak eki satırları yalnız başarılı gönderim transaction'ında
        // tüketilir; depolama dosyaları aynı kaldığı için içerik kaybolmaz.
        await tx.$executeRawUnsafe("SET LOCAL app.activity_draft_promote = 'evet'");
        await tx.activityDraftAttachment.deleteMany({ where: { draftId: draft.id } });
        await tx.activityDraft.delete({ where: { id: draft.id } });
      }

    // Donmuş aya kurala uygun biçimde sonradan kayıt girildiyse eski karne
    // değiştirilmez; aynı transaction'da yeni sürüm isteği doğar. Kuyruk
    // yazılamazsa faaliyet de yazılmış sayılmaz.
    await enqueueScoreRecalculation(tx, {
      userId: author.id,
      activityDate: created.activityDate,
      sourceType: "ACTIVITY_CREATED",
      sourceId: created.id,
      now,
    });

    // Denetim izi aynı işlemde yazılır (§15.2): "faaliyet kaydedildi ama izi
    // yok" durumu mümkün olmamalı.
    await recordAudit(tx, {
      userId: author.id,
      objectType: AUDIT_OBJECTS.activity,
      objectId: created.id,
      action: AUDIT_ACTIONS.activityCreated,
      detail: {
        activityDate: input.activityDate,
        revisionNo: 1,
        approvalStatus: baslangic.status,
      },
      now,
    });

    // Kapsam akışı canlı olsun: kaydı görebilecek olan üst zincire haber
    // gider. Haber içerik taşımaz — yalnız "tazele" der; ne yazıldığı
    // tazelemede görünürlük modülünden geçerek gelir.
    const ustZincir = await managementChain(tx, author.id);
    if (ustZincir.length > 0) {
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.activityCreated,
        userIds: ustZincir,
      });
    }

    if (baslangic.status === "PENDING_APPROVAL") {
      // Uygun onaylayıcılar **kayda yazılır** ve bir daha ağaçtan
      // türetilmez: birim sonradan taşınsa da akıştaki iş sessizce
      // başkasına devrolmaz.
      await tx.activityApprover.createMany({
        data: baslangic.approverIds.map((userId) => ({
          activityId: created.id,
          userId,
        })),
        skipDuplicates: true,
      });

      // Vekâlet süresince bildirim vekile de gider: aksi hâlde vekil, kendi
      // önüne düşmüş bir işi ancak ekranı elle açarsa görürdü (§4.5).
      const vekiller = await activeDeputiesOfMany(tx, baslangic.approverIds, now);
      const haberVerilecekler = [...new Set([...baslangic.approverIds, ...vekiller])];

      for (const approverId of haberVerilecekler) {
        await enqueueNotification(tx, {
          userId: approverId,
          eventType: NOTIFICATION_EVENTS.approvalPending,
          payload: { activityId: created.id, activityTitle: created.title },
          // Anahtar kişiyi de taşır: iki müdürlü birimde tek satır yazılıp
          // ikincisi sessizce elenirdi.
          idempotencyKey: `approval_pending:${created.id}:${approverId}`,
          now,
        });
      }

      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalPending,
        userIds: haberVerilecekler,
      });
    }

    // Yöneticisiz kalan kayıt sessizce beklemez: sistem yöneticisine alarm
    // gider (§4.4). Kayıt kaybolmaz, hata durumunda durur.
    if (baslangic.status === "MANAGER_NOT_FOUND") {
      const adminler = await tx.user.findMany({
        where: { isSystemAdmin: true, isActive: true },
        select: { id: true },
      });

      for (const admin of adminler) {
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
  // Sorgu baştan yazarla daraltılır: başkasının kaydı hiç okunmaz, dolayısıyla
  // "var ama senin değil" ile "hiç yok" dışarıdan ayırt edilemez.
  const activity = await activityMaintenanceReader(db).findFirst({
    where: { id: input.id, authorId },
  });

  if (!activity) return fail("not_found");
  if (activity.approvalStatus === "CANCELLED") return fail("cancelled");
  // Reddetme bir **son** durumdur: düzeltilip yeniden gönderilebilseydi
  // "düzeltme iste"den farkı kalmazdı.
  if (activity.approvalStatus === "REJECTED") return fail("rejected");

  // Düzeltme istenmiş kayıt pencereyi beklemez. Onay bekleyen ve onaylanmış
  // kayıt ise oluşturulduğu andan itibaren sistem yöneticisinin ayarladığı
  // pencere içinde, başka biri okumadıysa düzenlenebilir (§5.5, §8.2).
  const duzeltmeIsteniyor = activity.approvalStatus === "CHANGES_REQUESTED";
  const izin = await checkActivityEditPermission(db, authorId, activity, now);
  if (!izin.allowed) {
    if (izin.reason === "already_read") return fail("already_read");
    if (izin.reason === "window_closed") return fail("window_closed");
    return fail("conflict");
  }

  const retroactiveDays = await readNumericSetting(
    db,
    SETTING_KEYS.retroactiveEntryDays,
  );
  const dateProblem = checkActivityDate(input.activityDate, now, retroactiveDays);
  if (dateProblem === "future") return fail("future_date");
  // Düzenleme sırasında faaliyetin orijinal tarihi korunuyorsa geçmişe dönük
  // sınır denetlenmez; kayıt zaten zamanında oluşturulmuştur. Tarih ancak
  // yeni bir geçmiş tarihe değiştirilmek istenirse sınır aranır.
  const isDateChanged = companyDay(activity.activityDate) !== input.activityDate;
  if (isDateChanged && dateProblem === "too_old") return fail("date_too_old");

  const departmentProblem = await validateDepartments(
    db,
    input.targetDepartmentIds,
  );
  if (departmentProblem) return fail(departmentProblem);

  const validated = await validateIncomingFiles(db, options.files ?? []);
  if (!validated.ok) return fail(validated.error);

  // Transaction geri alınırsa yeni yüklenen ve henüz bir eki olmayan dosyalar
  // dışarıda temizlenir. Mevcut faaliyet eklerine dokunulmaz.
  let stored: StoredAttachmentFile[] = [];

  try {
    const updated = await db.$transaction(async (tx) => {
      await acquireScoreMutationLock(tx);

      // Faaliyet satırı kilitlenir ve durum işlem içinde yeniden doğrulanır:
      // düzeltme ile iptal yarışabiliyordu ve iptal önce tamamlansa bile
      // düzeltme, iptal edilmiş kaydın içeriğini değiştirebiliyordu
      // (denetim 18.08.2026, FAZ 4 bulgu 2).
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

      // Okuma ve düzenleme aynı faaliyet kilidini kullanır. Böylece karar
      // kilit altındaki son okuma görüntüsüne dayanır; sonradan gelen okuma
      // bu düzeltmeyi geriye dönük olarak kapatamaz.
      const tazeIzin = await checkActivityEditPermission(
        tx,
        authorId,
        fresh,
        now,
      );
      if (!tazeIzin.allowed) {
        throw new ActivityEditRefusalError(tazeIzin.reason);
      }

      const mevcutEkler = await attachmentMaintenanceReader(tx).findMany({
        where: { activityId: activity.id },
        select: { sha256: true, originalName: true },
      });
      const mevcutParmakIzleri = new Set(mevcutEkler.map(attachmentFingerprint));
      const yeniDosyalar = validated.value.filter((file, index, all) => {
        const key = attachmentFingerprint(file);
        if (mevcutParmakIzleri.has(key)) return false;
        return all.findIndex((candidate) => attachmentFingerprint(candidate) === key) === index;
      });
      const limits = await readAttachmentLimits(tx);
      const countProblem = checkAttachmentCount(
        mevcutEkler.length,
        yeniDosyalar.length,
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
          // Düzeltme kaydedilince iş yeniden müdürün önüne düşer (§5.4):
          // duzeltme_istendi → onay_bekliyor. Gerekçe temizlenir; kısıt da
          // başka durumda durmasına izin vermez.
          ...(duzeltmeIsteniyor
            ? {
                approvalStatus: "PENDING_APPROVAL" as const,
                approvalReasonId: null,
                approvalReasonKind: null,
                approvalReasonNote: null,
                approvalDecidedAt: null,
                // Sayaç baştan başlar: iş şimdi yeniden müdürün önünde.
                approvalSubmittedAt: now,
              }
            : {}),
        },
      });

      stored = await storeValidatedFiles(yeniDosyalar);
      for (const file of stored) {
        await tx.attachment.create({
          data: activityAttachmentData(activity.id, authorId, file, now),
        });
      }

      // Düzeltme yeniden gönderildi: **yeni bir tur** açılır. Tek sütun ikinci
      // turu yazarken birincinin üstüne yazardı; tur başına satır her turun
      // kendi süresini korur (P3-R2-1).
      if (duzeltmeIsteniyor) {
        await openApprovalRound(tx, activity.id, now);
      }

      // Muhatap listesi yeniden kurulur; hangi departmanların seçili olduğu
      // revizyon kaydında dondurulduğu için geçmiş bilgi kaybolmaz.
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

      // Düzeltme yapıldığında (özellikle müdürün düzeltme talebi üzerine yeniden gönderildiğinde),
      // kaydın diğer kullanıcılar (müdür vb.) için tekrar "okunmamış" görünmesi gerekir.
      // Eski okundu kayıtları temizlenir.
      await tx.readReceipt.deleteMany({
        where: { activityId: activity.id },
      });

      // Tarih başka aya taşınmış olabilir: eski ay kaydı kaybetti, yeni ay kayıt
      // kazandı. İki dönem de kendi değişmez sürümünü üretir.
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
          attachmentCount: yeniDosyalar.length,
        },
        now,
      });

      const uygunlar = await tx.activityApprover.findMany({
        where: { activityId: activity.id },
        select: { userId: true },
      });

      // Onay bekleyen kaydın içeriği değiştiğinde müdür kuyruğu ve açık ekran
      // tazelensin. Aynı tur korunur; yalnızca düzeltme istenmiş kayıt yeni
      // tur açar. Vekiller, ilk gönderimdeki bildirim kuralıyla aynıdır.
      if (
        uygunlar.length > 0 &&
        (activity.approvalStatus === "PENDING_APPROVAL" || duzeltmeIsteniyor)
      ) {
        const vekiller = await activeDeputiesOfMany(
          tx,
          uygunlar.map((satir) => satir.userId),
          now,
        );
        const haberVerilecekler = [
          ...new Set([...uygunlar.map((satir) => satir.userId), ...vekiller]),
        ];

        for (const approverId of haberVerilecekler) {
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
          userIds: haberVerilecekler,
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
