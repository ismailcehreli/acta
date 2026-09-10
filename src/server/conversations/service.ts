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

// Soru–cevap döngüsü (§9) — sistemin ana değer önerisi.
//
// Bir faaliyet üzerinde birbirinden bağımsız birden fazla konuşma olabilir
// (§9.1). Her konuşmanın **tek sorumlusu** vardır: iş kimde, her an bellidir.
// Cevap yalnızca ait olduğu konuşmayı ilerletir.

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
  // Görülemeyen faaliyetin varlığı da bildirilmez (§18.4).
  activity_not_found: "Faaliyet bulunamadı.",
  cannot_ask: "Bu faaliyete soru soramazsınız.",
  conversation_not_found: "Konuşma bulunamadı.",
  not_a_party: "Bu konuşmaya yazamazsınız.",
  closed: "Bu konuşma kapatılmış.",
  responsible_cannot_close:
    "Sorunun sorumlusu konuşmayı kapatamaz; cevabınızı yazın, kapatma kararı soruyu sorana aittir.",
  supervisor_too_early:
    "Bu konuşmayı henüz kapatamazsınız; soruyu soran kişi uzun süredir işlem yapmadıysa devreye girebilirsiniz.",
  reason_required: "Kapatma nedeni yazmalısınız.",
  already_closed: "Bu konuşma zaten kapatılmış.",
};

function fail(
  error: ConversationError,
): { ok: false; error: ConversationError; message: string } {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * Konuşmayı **faaliyetin güncel görünürlüğünden geçirerek** yükler.
 *
 * Konuşma kimliğini bilmek yetki değildir: kimlik zaten sayfada ve bildirim
 * içeriğinde taraflara veriliyor. Ayrıca görünürlük güncel ağaçtan hesaplanır
 * (§4.6) — başka bir dala taşınan kişi, eski konuşmasına yazmaya devam
 * edememelidir (denetim 18.08.2026, bulgu 1).
 */
async function loadVisibleConversation(
  db: ConversationDb,
  actor: Actor,
  conversationId: string,
  /**
   * Sistem yöneticisinin idari kapatması içerik erişimi gerektirmez (§9.3,
   * §15.1): yönetim işlevini yürütür, faaliyeti görmez. Yalnızca kapatma
   * yolunda açılır; yazma yollarında asla.
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
 * Soru sorma yetkisi (§9.2): faaliyeti görebilen üst kademe. Yazarın kendisi
 * kendi faaliyetine soru açmaz; görünürlük kuralı gereği akranlar zaten
 * faaliyeti göremez.
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
    // Faaliyet satırı kilitlenir: iptal ile soru açma yarışabiliyordu ve iptal
    // sonrasında yeni bir açık konuşma doğabiliyordu (denetim FAZ 4,
    // bulgu 2). Soru yalnızca kayda geçmiş faaliyette açılır.
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
        // Sorumlu, faaliyeti yazan kişidir: iş onun listesine düşer (§9.2).
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

    // Faaliyete hareket geldi: açık takip maddesinin hareketsizlik sayacı
    // sıfırlanır (§11.1). Konuşma sürüyorsa konu ölü değildir.
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

    // Haber iş işleminin içinde yayımlanır; PostgreSQL bildirimi commit'te
    // gönderir. Açılmamış bir konuşmanın haberi çıkmaz (Görev 7.3).
    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.questionAsked,
      userIds: [activity.authorId, actor.id],
    });

    return created;
  });

  // İptal araya girdi: soru açılmadı.
  if (conversation === null) return fail("activity_not_found");

  return { ok: true, value: conversation };
}

/**
 * Mesaj yazma (§9.2). Sorumluluk her mesajda karşı tarafa geçer: iş kimde,
 * her an bellidir. Tur sınırı yoktur (§9.4).
 */
export async function replyToConversation(
  db: ConversationDb,
  actor: Actor,
  input: { conversationId: string; text: string },
  now: Date,
): Promise<ConversationResult<Conversation>> {
  const conversation = await loadVisibleConversation(db, actor, input.conversationId);

  // Görünmeyen, var olmayan ve taraf olunmayan konuşma dışarıya **aynı** cevabı
  // verir; durum bilgisi ancak taraflık doğrulandıktan sonra açıklanır.
  if (!conversation) return fail("conversation_not_found");

  // Konuşmanın **tarafları sabittir**: soran ve faaliyeti yazan kişi.
  // `responsibleId` yalnızca "iş şu an kimde" göstergesidir ve her mesajda el
  // değiştirir; taraflığı ona bağlamak, sırası gelmeyen tarafı kendi
  // konuşmasından dışarı atardı.
  const respondentId = conversation.activity.authorId;
  const isParty = conversation.askerId === actor.id || respondentId === actor.id;
  if (!isParty) return fail("conversation_not_found");
  if (conversation.status === "CLOSED") return fail("closed");

  const counterpartId =
    actor.id === conversation.askerId ? respondentId : conversation.askerId;

  const updated = await db.$transaction(async (tx) => {
    // Konuşma satırı kilitlenir: iki mesaj aynı anda yazıldığında sorumluluk
    // yanlış tarafta kalabiliyor, kapatma ile mesaj yarışabiliyordu
    // (denetim FAZ 4, bulgu 3).
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

  // Konuşma bu sırada kapandı.
  if (updated === null) return fail("closed");

  return { ok: true, value: updated };
}

export async function closeConversation(
  db: ConversationDb,
  actor: Actor,
  conversationId: string,
  now: Date,
  /** İdari kapatmada zorunlu; diğer türlerde yok sayılır (§9.3). */
  reason?: string,
): Promise<ConversationResult<Conversation>> {
  const conversation = await loadVisibleConversation(db, actor, conversationId, {
    allowSystemAdminWithoutContent: true,
  });
  if (!conversation) return fail("conversation_not_found");

  // Soranın son hareketi doğrudan sorgulanır. Son N mesaj çekip içinde aramak,
  // konuşma uzadığında soranın mesajını pencerenin dışında bırakıyor ve sayacı
  // açılış tarihine döndürüyordu — üst, hak ettiğinden erken kapatabiliyordu
  // (denetim 18.08.2026, bulgu 6).
  const lastAskerMessage = await db.conversationMessage.findFirst({
    where: { conversationId, authorId: conversation.askerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  // Konuşmanın hedefi faaliyetin yazarıdır; sorumluluk cevapla el değiştirse
  // de "sorumlu kapatamaz" kuralı bu sabit role bağlıdır (§9.3).
  const respondentId = conversation.activity.authorId;

  const respondent = await db.user.findUnique({
    where: { id: respondentId },
    select: { isActive: true },
  });

  // İş günü sayacı şirketin çalışma takviminden beslenir. Saf fonksiyona
  // parametre olarak veriliyordu ama üretim yolu hiç doldurmuyordu: birim testi
  // elle tatil vererek yeşil oluyor, çalışan uç hafta sonu dışında hiçbir günü
  // atlamıyordu (denetim 18.08.2026, bulgu 6).
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

  // Gerekçe yalnız idari kapatmada saklanır; diğer türlerde alan boş kalmak
  // zorundadır (veritabanı kısıtı `Conversation_close_reason_matches_type`).
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

    // Araya başka bir kapatma girmiş olabilir; ikinci kapatma yazmaz.
    if (!fresh || fresh.status !== "OPEN") return null;

    const kapali = await tx.conversation.update({
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
      // İdari kapatma gerekçesi konuşma kaydındadır; denetim izi
      // içerik taşımaz (§15.1).
      detail: { closeType: decision.closeType },
      now,
    });

    // Kapatan sistem yöneticisi taraf olmayabilir; yine de kendi ekranı
    // tazelensin diye listeye giriyor.
    await publishRealtimeEvent(tx, {
      kind: REALTIME_EVENTS.conversationClosed,
      userIds: [conversation.askerId, respondentId, actor.id],
    });

    return kapali;
  });

  if (closed === null) return fail("already_closed");

  return { ok: true, value: closed };
}
