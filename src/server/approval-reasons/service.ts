import type { ApprovalReason, ApprovalReasonKind, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

// Onay kararı gerekçe kataloğu (ürün sahibi kararı, 19.08.2026).
//
// Serbest metinle kimse rapor üretemez: "faaliyetler neden reddediliyor"
// sorusunun cevabı, herkesin kendi cümlesini yazdığı bir yığında aranamaz.
// Bu yüzden kategori zorunlu ve **sistem yöneticisi tarafından tanımlanır**;
// kodda gerekçe listesi tutulmaz.
//
// Fiziksel silme yok (§16.6): kullanımdan kalkan gerekçe pasifleştirilir.
// Geçmiş kayıtlar gerekçesini korur — yabancı anahtar da silmeyi engeller.

export type ApprovalReasonDb = Pick<
  PrismaClient,
  "approvalReason" | "auditLog" | "$transaction"
>;

export type ReasonErrorCode =
  | "not_found"
  | "duplicate_label"
  | "last_active_reason"
  | "unknown";

export type ReasonResult =
  | { ok: true; reason: ApprovalReason }
  | { ok: false; error: ReasonErrorCode; message: string };

const MESSAGES: Record<ReasonErrorCode, string> = {
  not_found: "Gerekçe bulunamadı.",
  duplicate_label: "Bu karar türünde aynı adla bir gerekçe zaten var.",
  last_active_reason:
    "Bu karar türünün son aktif gerekçesi pasifleştirilemez; önce yenisini tanımlayın.",
  unknown: "Gerekçe kaydedilemedi.",
};

function fail(error: ReasonErrorCode): ReasonResult {
  return { ok: false, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown): ReasonResult {
  // **Metin değil kod.** Eskiden `includes("Unique constraint")` aranıyordu;
  // paketlenmiş sunucu kodunda o dizge aynı modülün kaynağında bulunuyor ve
  // Prisma başka bir hata için çağrı kaynağını mesaja eklediğinde katalog
  // "bu etiket zaten var" diyordu (denetim 23.08.2026, bulgu 11).
  if (isUniqueViolation(error)) return fail("duplicate_label");
  return fail("unknown");
}

/** Karar ekranında gösterilecek gerekçeler; yalnız aktif olanlar. */
export async function listActiveReasons(
  db: Pick<PrismaClient, "approvalReason">,
  kind: ApprovalReasonKind,
): Promise<ApprovalReason[]> {
  return db.approvalReason.findMany({
    where: { kind, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

/** Yönetim ekranı: pasifler de görünür. */
export async function listAllReasons(
  db: Pick<PrismaClient, "approvalReason">,
): Promise<ApprovalReason[]> {
  return db.approvalReason.findMany({
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
}

export async function createReason(
  db: ApprovalReasonDb,
  input: { kind: ApprovalReasonKind; label: string; sortOrder: number },
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  try {
    const reason = await db.$transaction(async (tx) => {
      const created = await tx.approvalReason.create({
        data: { kind: input.kind, label: input.label, sortOrder: input.sortOrder },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: created.id,
        action: AUDIT_ACTIONS.approvalReasonCreated,
        detail: { kind: created.kind, label: created.label },
        now,
      });

      return created;
    });

    return { ok: true, reason };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function updateReason(
  db: ApprovalReasonDb,
  input: { id: string; label: string; sortOrder: number },
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  const mevcut = await db.approvalReason.findUnique({ where: { id: input.id } });
  if (!mevcut) return fail("not_found");

  try {
    const reason = await db.$transaction(async (tx) => {
      const guncel = await tx.approvalReason.update({
        where: { id: input.id },
        data: { label: input.label, sortOrder: input.sortOrder },
      });

      // Etiket değişince **geçmiş kayıtların gerekçesi de değişir** — kayıt
      // kategoriye bağlıdır, metne değil. Bu yüzden değişiklik denetim izine
      // eski ve yeni hâliyle yazılır.
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: guncel.id,
        action: AUDIT_ACTIONS.approvalReasonUpdated,
        detail: {
          before: { label: mevcut.label, sortOrder: mevcut.sortOrder },
          after: { label: guncel.label, sortOrder: guncel.sortOrder },
        },
        now,
      });

      return guncel;
    });

    return { ok: true, reason };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Aktiflik değiştirme. **Son aktif gerekçe pasifleştirilemez:** katalogu
 * boşalan bir karar türü, o kararı hiç verilemez hâle getirirdi — müdür
 * reddetmek isteyip de seçecek gerekçe bulamazdı.
 */
export async function setReasonActive(
  db: ApprovalReasonDb,
  id: string,
  isActive: boolean,
  actorId: string,
  now: Date = new Date(),
): Promise<ReasonResult> {
  const mevcut = await db.approvalReason.findUnique({ where: { id } });
  if (!mevcut) return fail("not_found");

  // Ön eleme: kullanıcıya erken ve anlaşılır cevap vermek için. Kararın
  // dayandığı kontrol veritabanında (`ApprovalReason_keep_one_active`); bu
  // sayım kilitsiz olduğu için iki eşzamanlı pasifleştirme birbirini
  // göremiyor ve ikisi de geçiyordu (denetim 21.08.2026, bulgu 11).
  if (!isActive && mevcut.isActive) {
    const kalan = await db.approvalReason.count({
      where: { kind: mevcut.kind, isActive: true, id: { not: id } },
    });
    if (kalan === 0) return fail("last_active_reason");
  }

  try {
    const reason = await db.$transaction(async (tx) => {
      const guncel = await tx.approvalReason.update({
        where: { id },
        data: { isActive },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.approvalReason,
        objectId: id,
        action: isActive
          ? AUDIT_ACTIONS.approvalReasonActivated
          : AUDIT_ACTIONS.approvalReasonDeactivated,
        detail: { kind: guncel.kind, label: guncel.label },
        now,
      });

      return guncel;
    });

    return { ok: true, reason };
  } catch (error) {
    // Yarışı kaybeden ikinci işlem: ön elemede başka aktif gerekçe vardı,
    // tetikleyici kilidi aldığında artık yoktu.
    if (hasDatabaseSentinel(error, "LAST_APPROVAL_REASON")) {
      return fail("last_active_reason");
    }
    throw error;
  }
}
