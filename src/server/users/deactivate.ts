import type { PrismaClient, User } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { revokeAllUserSessions } from "@/server/auth/session";
import { resolveManager } from "@/server/org/resolve-manager";

// Pasifleştirme, kişinin üzerinde açık iş varken engellenir (§4.6). Sistem
// yöneticisine engellerin listesi gösterilir; hiçbiri sessizce atlanmaz.
//
// Sürüm 1 kapsamındaki engeller: cevap bekleyen sorular ve altındaki
// kullanıcılar. Bekleyen onaylar ve açık takip maddeleri Sürüm 2'de eklenecek
// (§18.2); o tablolar henüz açılmadığı için burada kontrol edilmez.

export type DeactivateUserDb = Pick<
  PrismaClient,
  "user" | "orgUnit" | "conversation" | "session" | "auditLog"
>;

/** Pasifleştirme tek işlemde yapılır; işlem başlatma yetkisi de gerekir. */
export type DeactivateUserRootDb = DeactivateUserDb &
  Pick<PrismaClient, "$transaction" | "$executeRaw">;

export interface DeactivationBlockers {
  /** Kişinin sorumlusu veya soranı olduğu açık konuşmalar. */
  openConversationCount: number;
  /** Yöneticisi bu kişi olan aktif kullanıcılar. */
  subordinates: { id: string; fullName: string }[];
}

export type DeactivateUserResult =
  | { ok: true; user: User; revokedSessionCount: number }
  | { ok: false; reason: "user_not_found" }
  | { ok: false; reason: "root_protected" }
  | { ok: false; reason: "blocked"; blockers: DeactivationBlockers };

/**
 * Kimlerin yöneticisi bu kişi? Kural §4.4'te tanımlı ve tek yerde durur; burada
 * tekrar yazılmaz, olduğu gibi çağrılır. Kişi birim yöneticisi değilse kimsenin
 * yöneticisi olamaz, o durumda hiç sorgu yapılmaz.
 */
export async function findSubordinates(
  db: DeactivateUserDb,
  user: Pick<User, "id" | "isUnitManager">,
): Promise<{ id: string; fullName: string }[]> {
  if (!user.isUnitManager) return [];

  const candidates = await db.user.findMany({
    where: { isActive: true, id: { not: user.id } },
    select: { id: true, fullName: true },
  });

  const subordinates: { id: string; fullName: string }[] = [];

  for (const candidate of candidates) {
    const manager = await resolveManager(db, candidate.id);
    if (manager.found && manager.managerId === user.id) {
      subordinates.push(candidate);
    }
  }

  return subordinates;
}

export async function collectDeactivationBlockers(
  db: DeactivateUserDb,
  user: Pick<User, "id" | "isUnitManager">,
): Promise<DeactivationBlockers> {
  const [openConversationCount, subordinates] = await Promise.all([
    db.conversation.count({
      where: {
        status: "OPEN",
        OR: [{ responsibleId: user.id }, { askerId: user.id }],
      },
    }),
    findSubordinates(db, user),
  ]);

  return { openConversationCount, subordinates };
}

/**
 * Pasifleştirme **tek işlemde** yapılır ve ağaç kilidini alır.
 *
 * Kontrol ile yazım ayrı işlemler olduğunda araya eşzamanlı bir istek girip
 * yeni bir açık konuşma açabiliyordu; ayrıca oturum iptali hata verdiğinde
 * kullanıcı güncellemesi çoktan kalıcı olmuş oluyordu (denetim FAZ 2,
 * bulgu 3). Kilit, kullanıcı ve birim değiştiren diğer yollarla paylaşılır.
 */
export async function deactivateUser(
  db: DeactivateUserRootDb,
  userId: string,
  now: Date,
  actorId: string | null = null,
): Promise<DeactivateUserResult> {
  return db.$transaction(async (tx) => {
    // Kilit fonksiyonu değer döndürmez; sonucu okumaya çalışmadan çalıştırılır.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'))`;

    const user = await tx.user.findUnique({ where: { id: userId } });

    if (!user) return { ok: false, reason: "user_not_found" };
    if (user.isRoot) return { ok: false, reason: "root_protected" };

    const blockers = await collectDeactivationBlockers(tx, user);

    if (blockers.openConversationCount > 0 || blockers.subordinates.length > 0) {
      return { ok: false, reason: "blocked", blockers };
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        // Yöneticilik devredilmeden pasifleştirme zaten engellenir; bayrağın
        // kalması birimi ikinci bir yönetici atanamaz hâle getirirdi (§4.2).
        isUnitManager: false,
      },
    });

    // Pasifleştirilen kişi elindeki açık oturumla sistemde kalamaz (§15.3).
    const revokedSessionCount = await revokeAllUserSessions(tx, userId, now);

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.user,
      objectId: userId,
      action: AUDIT_ACTIONS.userDeactivated,
      detail: { revokedSessionCount },
      now,
    });

    return { ok: true, user: updated, revokedSessionCount };
  });
}

export type ReactivateUserResult =
  | { ok: true; user: User }
  | { ok: false; reason: "user_not_found" | "already_active" | "inactive_org_unit" };

/**
 * Pasifleştirilmiş kullanıcıyı yeniden açar (ürün sahibi kararı, 19.08.2026).
 *
 * Kişi **yönetici olmadan** geri döner: pasifleştirme `isUnitManager` bayrağını
 * düşürüyor ve o boşluğa başka biri atanmış olabilir. Bayrağı sessizce geri
 * vermek, bir birimde iki yönetici oluşturmayı denemek ve veritabanı kısıtına
 * çarpmak demekti (§4.2). Yöneticilik gerekiyorsa düzenleme ekranından ayrıca
 * verilir.
 *
 * **Parola olduğu gibi durur.** Kişi eski parolasıyla giriş yapabilir;
 * pasifleştirme yalnız oturumları iptal etmişti. Yeni parola gerekiyorsa
 * sistem yöneticisi aynı ekrandan belirler.
 */
export async function reactivateUser(
  db: DeactivateUserRootDb,
  userId: string,
  now: Date,
  actorId: string | null = null,
): Promise<ReactivateUserResult> {
  return db.$transaction(async (tx) => {
    // Aynı kilit: birim pasifleştirme ile kullanıcı aktifleştirme yarışabilir.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'))`;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, orgUnit: { select: { isActive: true } } },
    });

    if (!user) return { ok: false, reason: "user_not_found" };
    if (user.isActive) return { ok: false, reason: "already_active" };
    // Aktif kullanıcı pasif birime bağlanamaz (§4.2, veritabanı tetikleyicisi).
    // Kural burada da okunur ki kullanıcı ham veritabanı hatası görmesin.
    if (!user.orgUnit.isActive) return { ok: false, reason: "inactive_org_unit" };

    const updated = await tx.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.user,
      objectId: userId,
      action: AUDIT_ACTIONS.userReactivated,
      now,
    });

    return { ok: true, user: updated };
  });
}
