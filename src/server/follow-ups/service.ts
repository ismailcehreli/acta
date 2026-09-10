import type { FollowUpItem, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";
import { isInManagementChain } from "@/server/org/chain";

// Takip maddeleri (§11).
//
// Madde bir boolean değil, geçmişi olan bağımsız kayıttır (§16.4). Excel'de
// "Açık/Kapalı" sütunu vardı ve öldü: kimse sahibi değildi, kapatmanın bedeli
// yoktu. Burada **sahiplik** ve **zorunlu kapanış notu** bu ikisini çözüyor.
//
// Sistem hiçbir maddeyi kendiliğinden yukarı taşımaz (§11.2). Yaptığı tek şey
// hareketsiz olanları ayrı bir ekranda görünür kılmak.

export type FollowUpDb = Pick<
  PrismaClient,
  | "followUpItem"
  | "followUpItemEvent"
  | "activityApprover"
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "auditLog"
  | "$transaction"
  | "$executeRaw"
  | "$queryRaw"
> & ActivityRepositoryDb;

export type FollowUpError =
  | "activity_not_found"
  | "activity_closed"
  | "already_open"
  | "not_found"
  | "not_allowed"
  | "note_required"
  | "owner_cannot_see"
  | "wrong_status";

export type FollowUpResult =
  | { ok: true; item: FollowUpItem }
  | { ok: false; error: FollowUpError; message: string };

const MESSAGES: Record<FollowUpError, string> = {
  activity_not_found: "Faaliyet bulunamadı.",
  activity_closed:
    "İptal edilmiş ya da reddedilmiş faaliyet için takip açılamaz.",
  already_open: "Bu faaliyetin zaten açık bir takip maddesi var.",
  not_found: "Takip maddesi bulunamadı.",
  not_allowed: "Bu işlem için yetkiniz yok.",
  note_required: "Kapanış notu zorunludur.",
  owner_cannot_see:
    "Seçilen kişi bu faaliyeti göremiyor; devredilirse takip edemez.",
  wrong_status: "Takip maddesi bu durumda değil.",
};

function fail(error: FollowUpError): FollowUpResult {
  return { ok: false, error, message: MESSAGES[error] };
}

/** İçeriği görebilmeyen kişi takip de açamaz, devralamaz. */
async function canSee(db: FollowUpDb, viewer: Viewer, activityId: string) {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true, authorId: true, approvalStatus: true },
  });
  return activity;
}

export interface OpenFollowUpInput {
  activityId: string;
  nextStep?: string | null;
  reviewDate?: Date | null;
  /** Devralacak kişi; boşsa açan kişi sahiplenir. */
  ownerId?: string | null;
}

export async function openFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  input: OpenFollowUpInput,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const activity = await canSee(db, actor, input.activityId);
  if (!activity) return fail("activity_not_found");

  // Kapanmış kayıt için takip açmak anlamsız: iptal edilen faaliyetin açık
  // maddeleri zaten otomatik kapanıyor (§5.5).
  if (activity.approvalStatus === "CANCELLED" || activity.approvalStatus === "REJECTED") {
    return fail("activity_closed");
  }

  const ownerId = input.ownerId ?? actor.id;
  if (ownerId !== actor.id) {
    const sahipGorur = await canSee(
      db,
      { id: ownerId, isSystemAdmin: false },
      input.activityId,
    );
    if (!sahipGorur) return fail("owner_cannot_see");
  }

  const acikVarMi = await db.followUpItem.count({
    where: { activityId: input.activityId, status: "OPEN" },
  });
  if (acikVarMi > 0) return fail("already_open");

  const item = await db.$transaction(async (tx) => {
    const created = await tx.followUpItem.create({
      data: {
        activityId: input.activityId,
        openedById: actor.id,
        ownerId,
        openedAt: now,
        lastMovedAt: now,
        nextStep: input.nextStep?.trim() || null,
        reviewDate: input.reviewDate ?? null,
      },
    });

    await tx.followUpItemEvent.create({
      data: { followUpId: created.id, kind: "OPENED", actorId: actor.id, createdAt: now },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: created.id,
      action: AUDIT_ACTIONS.followUpOpened,
      // Denetim izi içerik taşımaz (§15.1); yalnız hangi faaliyet.
      detail: { activityId: input.activityId },
      now,
    });

    return created;
  });

  return { ok: true, item };
}

/**
 * Kapatma yetkisi: **sahibi ve üstündeki yöneticiler** (§11.1). Maddeyi açan
 * kişi de sahibi değilse kapatamaz — sahiplik devredilebildiği için "açan"
 * ile "sorumlu" ayrışabiliyor.
 */
async function canManage(
  db: FollowUpDb,
  actor: Viewer,
  item: { ownerId: string; openedById: string },
): Promise<boolean> {
  if (actor.id === item.ownerId || actor.id === item.openedById) return true;
  return isInManagementChain(db, item.ownerId, actor.id);
}

export async function closeFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  note: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const gerekce = note.trim();
  if (gerekce === "") return fail("note_required");

  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "OPEN") return fail("wrong_status");

  const guncel = await db.$transaction(async (tx) => {
    // **Durum kilit altında yeniden okunur** (denetim 21.08.2026,
    // bulgu 10). Kilitsiz kurguda iki yönetici aynı maddeyi aynı anda farklı
    // notlarla kapatabiliyordu: ikisi de başarı dönüyor ve olay geçmişinde
    // arada REOPENED olmadan iki CLOSED satırı doğuyordu. Madde bir boolean
    // değil, **geçmişi olan** bir kayıt (§11.1); geçmiş gerçekte olmamış bir
    // ikinci kapanışı göstermemeli.
    await tx.$executeRaw`SELECT "id" FROM "FollowUpItem" WHERE "id" = ${followUpId} FOR UPDATE`;

    const taze = await tx.followUpItem.findUnique({
      where: { id: followUpId },
      select: { status: true },
    });
    if (!taze || taze.status !== "OPEN") return null;

    const kapali = await tx.followUpItem.update({
      where: { id: followUpId },
      data: {
        status: "CLOSED",
        closedById: actor.id,
        closedAt: now,
        closingNote: gerekce,
        lastMovedAt: now,
      },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "CLOSED",
        actorId: actor.id,
        note: gerekce,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpClosed,
      now,
    });

    return kapali;
  });

  // Kilidi kaybeden ikinci çağrı: madde bu arada kapanmış.
  if (!guncel) return fail("wrong_status");

  return { ok: true, item: guncel };
}

/** Yeniden açma (§11.1): mümkündür, gerekçeyle. */
export async function reopenFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  note: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const gerekce = note.trim();
  if (gerekce === "") return fail("note_required");

  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "CLOSED") return fail("wrong_status");

  const acikVarMi = await db.followUpItem.count({
    where: { activityId: item.activityId, status: "OPEN" },
  });
  if (acikVarMi > 0) return fail("already_open");

  const guncel = await db.$transaction(async (tx) => {
    const acik = await tx.followUpItem.update({
      where: { id: followUpId },
      data: {
        status: "OPEN",
        closedById: null,
        closedAt: null,
        closingNote: null,
        lastMovedAt: now,
      },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "REOPENED",
        actorId: actor.id,
        note: gerekce,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpReopened,
      now,
    });

    return acik;
  });

  return { ok: true, item: guncel };
}

/** Devir (§4.6): pasifleştirme öncesi açık işler devredilir ya da kapatılır. */
export async function transferFollowUp(
  db: FollowUpDb,
  actor: Viewer,
  followUpId: string,
  newOwnerId: string,
  now: Date = new Date(),
): Promise<FollowUpResult> {
  const item = await db.followUpItem.findUnique({ where: { id: followUpId } });
  if (!item) return fail("not_found");
  if (!(await canManage(db, actor, item))) return fail("not_allowed");
  if (item.status !== "OPEN") return fail("wrong_status");

  // Göremediği bir faaliyetin takibini devralan kişi, takip edemeyeceği bir
  // iş üstlenmiş olurdu.
  const gorur = await canSee(
    db,
    { id: newOwnerId, isSystemAdmin: false },
    item.activityId,
  );
  if (!gorur) return fail("owner_cannot_see");

  const guncel = await db.$transaction(async (tx) => {
    const devredilen = await tx.followUpItem.update({
      where: { id: followUpId },
      data: { ownerId: newOwnerId, lastMovedAt: now },
    });

    await tx.followUpItemEvent.create({
      data: {
        followUpId,
        kind: "TRANSFERRED",
        actorId: actor.id,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.followUp,
      objectId: followUpId,
      action: AUDIT_ACTIONS.followUpTransferred,
      detail: { newOwnerId },
      now,
    });

    return devredilen;
  });

  return { ok: true, item: guncel };
}

/**
 * Faaliyete hareket geldi (§11.1: "faaliyete yeni yorum/cevap geldiğinde
 * güncellenir"). Açık madde yoksa hiçbir şey yapmaz.
 */
export async function touchFollowUps(
  db: Pick<PrismaClient, "followUpItemEvent" | "$queryRaw">,
  activityId: string,
  /** Hareketi yapan kişi: soruyu soran ya da cevabı yazan. */
  actorId: string,
  now: Date,
): Promise<void> {
  // **Tek ifade, tek karar** (denetim 23.08.2026, P3-R3-5).
  //
  // Önce oku–sonra yaz kurgusunda iki şey bozuluyordu: gecikmiş bir istek
  // daha yeni bir hareketin üstüne eski zamanı yazıp `lastMovedAt` değerini
  // **geriye** götürebiliyor, ve okuma ile yazma arasında kapanan bir madde
  // kapandıktan sonra yeniden hareket görebiliyordu. `GREATEST` zamanı
  // monoton tutuyor, `WHERE status = 'OPEN'` kararı yazma anına taşıyor ve
  // `RETURNING` yalnız **gerçekten** güncellenen satırları veriyor.
  const guncellenen = await db.$queryRaw<{ id: string }[]>`
    UPDATE "FollowUpItem"
    SET "lastMovedAt" = GREATEST("lastMovedAt", ${now}),
        "updatedAt" = GREATEST("updatedAt", ${now})
    WHERE "activityId" = ${activityId} AND "status" = 'OPEN'
    RETURNING "id"
  `;

  if (guncellenen.length === 0) return;

  // **Hareket geçmişe de yazılır** (P3-R2-3). `lastMovedAt` güncel bir
  // sütundur ve yalnız "şu an ne kadar hareketsiz" sorusunu cevaplar;
  // kapanmış bir dönemin hesabı ondan yapılamaz. Olay içerik taşımaz, ama
  // **kim** hareket ettirdiğini taşır: aktör soruyu soran ya da cevabı
  // yazandır, maddenin sahibi değil (P3-R3-4).
  await db.followUpItemEvent.createMany({
    data: guncellenen.map((madde) => ({
      followUpId: madde.id,
      kind: "TOUCHED" as const,
      actorId,
      createdAt: now,
    })),
  });
}

/**
 * Faaliyet iptal edilince açık maddeler otomatik kapanır (§5.5). Gerekçe
 * sabittir: kaydın kendisi ortadan kalktığı için takip edilecek bir şey yok.
 */
export async function closeFollowUpsForCancelledActivity(
  db: Pick<PrismaClient, "followUpItem" | "followUpItemEvent">,
  activityId: string,
  actorId: string,
  now: Date,
): Promise<number> {
  const acikOlanlar = await db.followUpItem.findMany({
    where: { activityId, status: "OPEN" },
    select: { id: true },
  });

  for (const madde of acikOlanlar) {
    await db.followUpItem.update({
      where: { id: madde.id },
      data: {
        status: "CLOSED",
        closedById: actorId,
        closedAt: now,
        closingNote: "Faaliyet iptal edildi.",
        lastMovedAt: now,
      },
    });

    await db.followUpItemEvent.create({
      data: {
        followUpId: madde.id,
        kind: "CLOSED",
        actorId,
        note: "Faaliyet iptal edildi.",
        createdAt: now,
      },
    });
  }

  return acikOlanlar.length;
}
