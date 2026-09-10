import type { Activity, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  lockActivityForMaintenance,
} from "@/server/authz/activity-repository";

import { canViewActivity, type VisibilityDb } from "@/server/authz/visibility";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { isInManagementChain } from "@/server/org/chain";
import { closeFollowUpsForCancelledActivity } from "@/server/follow-ups/service";
import {
  acquireScoreMutationLock,
  enqueueScoreRecalculation,
} from "@/server/scoring/recalculation";

// Faaliyet iptali (§5.5).
//
// Silme yoktur: kayıt üstü çizili kalır, aramada ve raporda "iptal" etiketiyle
// görünür. İptal **geri alınamaz** — veritabanı da CANCELLED durumundan çıkışa
// izin vermez. Hata varsa yeni faaliyet yazılır.

export type CancelActivityDb = Pick<
  PrismaClient,
  | "activity"
  | "cancellationRecord"
  | "conversation"
  | "followUpItem"
  | "followUpItemEvent"
  | "notificationQueue"
  | "auditLog"
  | "user"
  | "orgUnit"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
  | "$transaction"
  | "$executeRaw"
> &
  VisibilityDb;

export type CancelError =
  | "not_found"
  | "not_allowed"
  | "already_cancelled"
  | "reason_required"
  /** İptal yalnızca onaylanmış faaliyet için tanımlıdır (§5.4 durum modeli). */
  | "not_cancellable";

export type CancelResult =
  | { ok: true; activity: Activity; closedConversationCount: number }
  | { ok: false; error: CancelError; message: string };

// Yetkisiz erişim ile var olmayan kayıt **aynı** cevabı alır; durum bilgisi
// (zaten iptal edilmiş vb.) ancak yetki doğrulandıktan sonra açıklanır
// (denetim 18.08.2026, bulgu 1).
const MESSAGES: Record<CancelError, string> = {
  not_found: "Faaliyet bulunamadı.",
  not_allowed: "Faaliyet bulunamadı.",
  already_cancelled: "Faaliyet zaten iptal edilmiş.",
  reason_required: "İptal gerekçesi zorunludur.",
  not_cancellable:
    "Bu faaliyet iptal edilemez; iptal yalnızca kayda geçmiş faaliyetler için tanımlıdır.",
};

function fail(error: CancelError): CancelResult {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * İptal yetkisi: yazan kişi veya üstündeki herhangi bir yönetici (§5.5).
 *
 * Ek koşul: kişinin faaliyeti **görebiliyor** olması gerekir. Üst zincir, onay
 * sürecindeki kayıtları görmez (§8.2); görmediği bir kaydı iptal edebilmesi
 * tutarsız olurdu. Sürüm 1'de tüm kayıtlar onaylı doğduğu için bu koşul
 * pratikte hiçbir şeyi değiştirmez, ama kural doğru tarafta durur.
 */
export async function canCancelActivity(
  db: VisibilityDb & Pick<PrismaClient, "user" | "orgUnit">,
  activity: Pick<Activity, "id" | "authorId" | "approvalStatus">,
  actor: { id: string; isSystemAdmin: boolean },
): Promise<boolean> {
  const level = await canViewActivity(db, actor, activity);
  if (level !== "full") return false;

  if (activity.authorId === actor.id) return true;
  return isInManagementChain(db, activity.authorId, actor.id);
}

export async function cancelActivity(
  db: CancelActivityDb,
  actor: { id: string; isSystemAdmin: boolean },
  activityId: string,
  reason: string,
  now: Date,
): Promise<CancelResult> {
  const actorId = actor.id;
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) return fail("reason_required");

  const activity = await activityMaintenanceReader(db).findUnique({ where: { id: activityId } });
  if (!activity) return fail("not_found");

  // Yetki, durum kontrollerinden **önce** doğrulanır: "zaten iptal edilmiş"
  // cevabı yetkisiz birine kaydın durumunu açıklardı.
  //
  // Bu **ön eleme**dir; kararın dayandığı kontrol kilitten sonra, işlemin
  // içinde tekrarlanır (denetim 21.08.2026, bulgu 5).
  if (!(await canCancelActivity(db, activity, actor))) {
    return fail("not_allowed");
  }

  if (activity.approvalStatus === "CANCELLED") return fail("already_cancelled");

  // İptal yalnızca onaylanmış faaliyet için tanımlıdır (§5.4). Veritabanı da
  // başka geçişi reddediyor; burada durdurulmazsa kullanıcı 500 görürdü
  // (denetim 18.08.2026, bulgu 6).
  if (activity.approvalStatus !== "APPROVED") return fail("not_cancellable");

  const result = await db.$transaction(async (tx) => {
    await acquireScoreMutationLock(tx);

    // Faaliyet satırı kilitlenir: yetki, durum ve yan etkiler tek karara
    // bağlanmalı. Kilitsiz kurguda düzeltme ile iptal yarışabiliyor, araya
    // yeni konuşma açılabiliyordu (bulgu 5).
    await lockActivityForMaintenance(tx, activityId);

    // Durum işlem içinde yeniden doğrulanır: araya başka bir iptal girmiş
    // olabilir.
    const fresh = await activityMaintenanceReader(tx).findUnique({
      where: { id: activityId },
      select: {
        id: true,
        authorId: true,
        activityDate: true,
        approvalStatus: true,
      },
    });
    if (!fresh || fresh.approvalStatus !== "APPROVED") return null;

    // **Yetki de yeniden doğrulanır** (bulgu 5). Görünürlük güncel
    // ağaçtan hesaplanır (§4.6): iptale basan yönetici kilitte beklerken
    // yazar başka bir dala taşınırsa, kilit açıldığında artık o kaydı
    // göremeyen biri kaydı iptal ediyordu. Ön kontrolün sonucu, yazmanın
    // yapıldığı anın kanıtı değildir.
    if (!(await canCancelActivity(tx, fresh, actor))) return null;

    const openConversations = await tx.conversation.findMany({
      where: { activityId, status: "OPEN" },
      select: { id: true, askerId: true, responsibleId: true },
    });

    const cancelled = await tx.activity.update({
      where: { id: activityId },
      data: { approvalStatus: "CANCELLED", updatedAt: now },
    });

    await tx.cancellationRecord.create({
      data: {
        activityId,
        cancelledById: actorId,
        reason: trimmedReason,
        createdAt: now,
      },
    });

    await enqueueScoreRecalculation(tx, {
      userId: fresh.authorId,
      activityDate: fresh.activityDate,
      sourceType: "ACTIVITY_CANCELLED",
      sourceId: activityId,
      now,
    });

    // İptal edilen faaliyetin açık takip maddeleri **otomatik kapanır**
    // (§5.5). Takip edilecek bir kayıt kalmadı; açık bırakmak, kimsenin
    // kapatamayacağı bir madde üretirdi.
    await closeFollowUpsForCancelledActivity(tx, activityId, actorId, now);

    // İptal edilen faaliyetin açık konuşmaları kapanır: cevabı beklenen soru
    // ortada kalmaz (§5.5, §9.3). Kapanış türü **idari değildir** — idari
    // kapatma sistem yöneticisinin gerekçeli işlemidir; ikisini aynı türde
    // birleştirmek raporlamayı kirletiyordu (ürün sahibi kararı, açık soru 9).
    // Gerekçe burada tekrarlanmaz; faaliyetin iptal kaydında durur.
    for (const conversation of openConversations) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status: "CLOSED",
          closedById: actorId,
          closedAt: now,
          closeType: "CANCELLED_ACTIVITY",
        },
      });
    }

    // Taraflara haber verilir. Gönderim işleyici sürecinde yapılacak
    // (Görev 5.3); burada yalnızca kuyruğa yazılır — aynı işlemde, çünkü
    // iptal olup bildirimin yazılmaması sessiz bir kayıptır.
    const recipients = new Set<string>();
    for (const conversation of openConversations) {
      recipients.add(conversation.askerId);
      recipients.add(conversation.responsibleId);
    }
    recipients.delete(actorId);

    for (const userId of recipients) {
      // Aynı olay iki kez işlense de kişiye tek bildirim gider (§12.3).
      await enqueueNotification(tx, {
        userId,
        eventType: NOTIFICATION_EVENTS.activityCancelled,
        payload: {
          activityId,
          activityTitle: activity.title,
          reason: trimmedReason,
        },
        idempotencyKey: `activity_cancelled:${activityId}:${userId}`,
        now,
      });
    }

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.activity,
      objectId: activityId,
      action: AUDIT_ACTIONS.activityCancelled,
      // Gerekçe metni **kayda geçmez**: sistem yöneticisi denetim izini görür
      // ama içeriğe erişemez (§15.1). Gerekçenin kendisi iptal kaydındadır ve
      // görünürlük modülünden geçer.
      detail: { closedConversationCount: openConversations.length },
      now,
    });

    // Ekranı tazelemesi gerekenler: kapanan konuşmaların tarafları, faaliyeti
    // yazan ve iptal eden. Bildirim listesinden farkı, iptal edenin de
    // çıkarılmaması — kendi ekranı da değişti (Görev 7.3).
    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.activityCancelled,
      userIds: [...recipients, activity.authorId, actorId],
    });

    return { cancelled, closedConversationCount: openConversations.length };
  });

  // İşlem içinde durum değişmişse (araya başka bir iptal girdi) sonuç yok.
  if (result === null) return fail("already_cancelled");

  return {
    ok: true,
    activity: result.cancelled,
    closedConversationCount: result.closedConversationCount,
  };
}
