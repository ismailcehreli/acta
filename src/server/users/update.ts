import type { PrismaClient, User } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

import { hashPassword } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { isEmailDomainAllowed } from "@/server/settings/email-domains";
import { readAllowedEmailDomains } from "@/server/settings/system-settings";

// Kullanıcı bilgisi düzenleme ve yönetici eliyle parola belirleme (§4.6, §15.1).
//
// Bir kural veritabanında zaten var ve burada tekrarlanmaz: pasif birime aktif
// kullanıcı bağlanamaz. "Bir birimde en fazla bir yönetici" kısıtı
// 20.08.2026'da kaldırıldı — bir departmanda birden fazla müdür olabiliyor.
//
// Burada olan iki koruma ise **geri dönüşü olmayan** durumları engeller:
// son sistem yöneticisinin yetkisi kaldırılamaz ve kişi kendini
// pasifleştiremez. İkisi de sistemi yönetilemez hâle getirirdi.

export type UpdateUserDb = Pick<
  PrismaClient,
  | "$queryRaw"
  | "$executeRaw"
  | "user"
  | "userCredential"
  | "session"
  | "orgUnit"
  | "auditLog"
  | "systemSetting"
  | "$transaction"
>;

export type UpdateUserErrorCode =
  | "user_not_found"
  | "duplicate_email"
  | "email_domain_not_allowed"
  | "unit_not_found"
  | "inactive_unit"
  | "last_system_admin"
  | "root_protected"
  | "unknown";

export type UpdateUserResult =
  | { ok: true; user: User }
  | { ok: false; error: UpdateUserErrorCode; message: string };

const MESSAGES: Record<UpdateUserErrorCode, string> = {
  user_not_found: "Kullanıcı bulunamadı.",
  duplicate_email: "Bu e-posta adresi başka bir kullanıcıda kayıtlı.",
  email_domain_not_allowed: "Bu e-posta alan adı kabul edilmiyor.",
  unit_not_found: "Seçilen birim bulunamadı.",
  inactive_unit: "Pasif bir birime aktif kullanıcı bağlanamaz.",
  last_system_admin:
    "Sistemdeki son sistem yöneticisinin yetkisi kaldırılamaz; önce başka bir sistem yöneticisi tanımlayın.",
  root_protected:
    "Ana sistem yöneticisi hesabı korunuyor; bu işlem başka bir kullanıcı için yapılabilir.",
  unknown: "Kullanıcı güncellenemedi.",
};

function fail(error: UpdateUserErrorCode): UpdateUserResult {
  return { ok: false, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown): UpdateUserResult {
  // Tekillik önce ve **hata kodundan** (bkz. `src/server/db-errors.ts`).
  if (isUniqueViolation(error)) {
    // Geriye tek tekillik kısıtı kaldı: e-posta. "Birim başına tek yönetici"
    // kısıtı 20.08.2026'da kaldırıldı.
    return fail("duplicate_email");
  }

  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_unit");
  }

  // Yarışı kaybeden ikinci işlem buraya düşer: ön eleme sırasında başka bir
  // aktif yönetici vardı, tetikleyici kilidi aldığında artık yoktu.
  if (hasDatabaseSentinel(error, "LAST_SYSTEM_ADMIN")) {
    return fail("last_system_admin");
  }

  if (hasDatabaseSentinel(error, "ROOT_USER_PROTECTED")) {
    return fail("root_protected");
  }

  return fail("unknown");
}

export interface UpdateUserInput {
  id: string;
  fullName: string;
  /** Unvan; boş bırakılabilir. Yetki değildir. */
  title?: string | null;
  email: string;
  orgUnitId: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  writesActivities: boolean;
  /** Skoru hesaplanır mı (Görev 11.10); verilmezse değişmez. */
  isScored?: boolean;
  /** Faaliyetlere takdir verebilir mi (Görev 11.11); verilmezse değişmez. */
  canAppreciate?: boolean;
  /** Yönetim raporlarını görebilir mi; verilmezse değişmez. */
  canViewReports?: boolean;
  /** Skor ve takdir raporlarını görebilir mi; verilmezse değişmez. */
  canViewScoreReports?: boolean;
}

/**
 * Bölüm müdürünün verebileceği alanlar. Tasarım ona **ad ve unvan**
 * düzenlemesi veriyor; listenin kısalığı bilinçli.
 */
export interface ManagerUpdateUserInput {
  id: string;
  fullName: string;
  title?: string | null;
}

export interface RootSelfUpdateInput {
  id: string;
  orgUnitId: string;
  writesActivities: boolean;
  isScored: boolean;
  canAppreciate: boolean;
  canViewReports?: boolean;
  canViewScoreReports?: boolean;
}

/**
 * Son aktif sistem yöneticisi mi? Yetkisi kaldırılırsa ya da pasifleştirilirse
 * yönetim ekranlarına girebilecek kimse kalmaz ve geri dönüş yolu yoktur —
 * kullanıcı açmak için giriş, giriş için kullanıcı gerekir.
 */
async function isLastSystemAdmin(
  db: Pick<PrismaClient, "user">,
  userId: string,
): Promise<boolean> {
  const digerleri = await db.user.count({
    where: { isSystemAdmin: true, isActive: true, id: { not: userId } },
  });

  return digerleri === 0;
}

/**
 * Bölüm müdürünün kullanıcı düzenlemesi (Paket 1).
 *
 * Müdür yalnız **ad ve unvan** değiştirir; başka hiçbir kolona dokunulmaz.
 * Yetki kontrolü çağırandan gelmez: aktörün kimliği verilir, kapsam
 * **yazma ifadesinin içinde** ve o anki ağaca göre hesaplanır.
 * Fazla alanı temizlemek yerine hiç almamak seçildi: temizleyen kod, şemaya
 * yeni bir alan eklendiğinde güncellenmeyi bekler ve unutulur — açık sessizce
 * geri gelir.
 *
 * Denetimde yakalanan yol (23.08.2026): müdür astının e-postasını kendi
 * adresine çevirip şifre sıfırlama tetikleyebiliyordu ve bağlantı ona
 * gidiyordu. Aynı istek alt müdürü görevden düşürüyor, skor ve takdir
 * bayraklarını siliyordu.
 */
export async function updateUserByManager(
  db: UpdateUserDb,
  input: ManagerUpdateUserInput,
  actorId: string,
  now: Date = new Date(),
): Promise<UpdateUserResult> {
  try {
    return await db.$transaction(async (tx) => {
      // `before` değerleri **kilitli** okunuyor: kilitsiz okunduğunda, araya
      // giren bir düzenlemeden sonra denetim kaydı gerçek B → C değişimi
      // yerine eski A → C yazıyordu (23.08.2026, üçüncü denetim turu).
      const kilitli = await tx.$queryRaw<
        { fullName: string; title: string | null }[]
      >`SELECT "fullName", "title" FROM "User" WHERE "id" = ${input.id} FOR UPDATE`;

      const mevcut = kilitli[0];
      if (!mevcut) return fail("user_not_found");

      // **Yetkinin tamamı yazma ifadesinin içinde.** Önce kapsam listesi
      // hesaplanıp servise "yetki belgesi" gibi veriliyordu; liste dışarıda
      // üretildiği için, arada hedefin birimi müdürün dalından çıkarılsa bile
      // eski liste hâlâ o birimi içeriyor ve yazma geçiyordu (23.08.2026,
      // üçüncü denetim turu). Kontrol ile yazma arasında pencere kalmasın diye
      // ikisi tek ifadeye alındı.
      //
      // İfade beş şeyi aynı anda doğruluyor: aktör aktif, aktör hâlâ birim
      // yöneticisi, hedef aktörün kendisi değil, hedef sistem yöneticisi
      // değil ve hedefin birimi aktörün **o andaki** alt ağacında.
      const yazilan = await tx.$executeRaw`
        UPDATE "User" AS hedef
        SET "fullName" = ${input.fullName},
            "title" = ${input.title ?? null},
            "updatedAt" = ${now}
        WHERE hedef."id" = ${input.id}
          -- Kendi hesabı bu yoldan yönetilmez (müdür yetkisinin 3. sınırı).
          -- Aktörün kendi kaydı kendi alt ağacında olduğu için kapsam koşulu
          -- bunu **engellemiyordu**; sunucu eylemindeki ön eleme maskeliyordu
          -- ama servis doğrudan yetki sınırı olarak sınanıyor.
          AND hedef."id" <> ${actorId}
          AND hedef."isSystemAdmin" = FALSE
          AND EXISTS (
            WITH RECURSIVE subtree(id) AS (
              SELECT aktor."orgUnitId"
              FROM "User" aktor
              WHERE aktor."id" = ${actorId}
                AND aktor."isActive"
                AND aktor."isUnitManager"
              UNION ALL
              SELECT birim."id"
              FROM "OrgUnit" birim
              JOIN subtree ON birim."parentId" = subtree.id
            )
            SELECT 1 FROM subtree WHERE subtree.id = hedef."orgUnitId"
          )
      `;

      // "Var ama yetkin yok" ile "yok" aynı cevabı alır (§15.1).
      if (yazilan === 0) return fail("user_not_found");

      const guncel = await tx.user.findUniqueOrThrow({ where: { id: input.id } });

      // Denetim kaydı **değişen alanları** taşır. Önceki hâlinde yalnız
      // e-posta, birim ve bayrakların önce/sonrası yazılıyordu; müdür yolunda
      // bunlar hiç değişmediği için kayıt "kim kimi düzenledi" diyor ama
      // "neyi değiştirdi" demiyordu.
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: guncel.id,
        action: AUDIT_ACTIONS.userUpdated,
        detail: {
          before: { fullName: mevcut.fullName, title: mevcut.title },
          after: { fullName: guncel.fullName, title: guncel.title },
        },
        now,
      });

      return { ok: true as const, user: guncel };
    });
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function updateUser(
  db: UpdateUserDb,
  input: UpdateUserInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<UpdateUserResult> {
  const mevcut = await db.user.findUnique({ where: { id: input.id } });
  if (!mevcut) return fail("user_not_found");
  if (mevcut.isRoot) return fail("root_protected");

  const unit = await db.orgUnit.findUnique({
    where: { id: input.orgUnitId },
    select: { isActive: true },
  });
  if (!unit) return fail("unit_not_found");
  if (!unit.isActive && mevcut.isActive) return fail("inactive_unit");

  // Kısıt yalnız **değişen** adrese uygulanır. Kısıt sonradan konulduğunda
  // eski adresli kullanıcıların adı ya da birimi düzenlenemez hâle gelmemeli.
  if (input.email !== mevcut.email) {
    const izinliler = await readAllowedEmailDomains(db);
    if (!isEmailDomainAllowed(input.email, izinliler)) {
      return {
        ok: false,
        error: "email_domain_not_allowed",
        message: `Adres yalnız şu alan adlarıyla olabilir: ${izinliler.join(", ")}`,
      };
    }
  }

  // Ön eleme: kullanıcıya erken ve anlaşılır bir cevap vermek için. Kararın
  // dayandığı kontrol veritabanında (`User_keep_system_admin` tetikleyicisi);
  // buradaki sayım kilitsiz olduğu için iki eşzamanlı işlem birbirini
  // göremiyordu ve ikisi de geçiyordu (denetim 21.08.2026, bulgu 6).
  if (
    mevcut.isSystemAdmin &&
    !input.isSystemAdmin &&
    mevcut.isActive &&
    (await isLastSystemAdmin(db, input.id))
  ) {
    return fail("last_system_admin");
  }

  try {
    const user = await db.$transaction(async (tx) => {
      const guncel = await tx.user.update({
        where: { id: input.id },
        data: {
          fullName: input.fullName,
          title: input.title ?? null,
          // E-posta yalnızca bir özelliktir; iç kimlik ondan bağımsızdır (§15.3).
          email: input.email.trim().toLowerCase(),
          orgUnitId: input.orgUnitId,
          isUnitManager: input.isUnitManager,
          isSystemAdmin: input.isSystemAdmin,
          writesActivities: input.writesActivities,
          // Verilmezse değişmez: bölüm müdürünün formunda bu alanlar yok.
          ...(input.isScored === undefined ? {} : { isScored: input.isScored }),
          ...(input.canAppreciate === undefined
            ? {}
            : { canAppreciate: input.canAppreciate }),
          ...(input.canViewReports === undefined
            ? {}
            : { canViewReports: input.canViewReports }),
          ...(input.canViewScoreReports === undefined
            ? {}
            : { canViewScoreReports: input.canViewScoreReports }),
        },
      });

      // Yetki değişikliği ayrıca görünür olsun diye eski ve yeni hâl birlikte
      // yazılır (§15.2).
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: guncel.id,
        action: AUDIT_ACTIONS.userUpdated,
        detail: {
          before: {
            email: mevcut.email,
            orgUnitId: mevcut.orgUnitId,
            isUnitManager: mevcut.isUnitManager,
            isSystemAdmin: mevcut.isSystemAdmin,
            writesActivities: mevcut.writesActivities,
            canViewReports: mevcut.canViewReports,
            canViewScoreReports: mevcut.canViewScoreReports,
          },
          after: {
            email: guncel.email,
            orgUnitId: guncel.orgUnitId,
            isUnitManager: guncel.isUnitManager,
            isSystemAdmin: guncel.isSystemAdmin,
            writesActivities: guncel.writesActivities,
            canViewReports: guncel.canViewReports,
            canViewScoreReports: guncel.canViewScoreReports,
          },
        },
        now,
      });

      return guncel;
    });

    return { ok: true, user };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Root'un kendisi için açıkça izin verilen operasyonel alanlar. */
export async function updateRootSelf(
  db: UpdateUserDb,
  input: RootSelfUpdateInput,
  actorId: string,
  now: Date = new Date(),
): Promise<UpdateUserResult> {
  if (input.id !== actorId) return fail("root_protected");

  const unit = await db.orgUnit.findUnique({
    where: { id: input.orgUnitId },
    select: { isActive: true },
  });
  if (!unit) return fail("unit_not_found");
  if (!unit.isActive) return fail("inactive_unit");

  try {
    const user = await db.$transaction(async (tx) => {
      const mevcut = await tx.user.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          isRoot: true,
          isSystemAdmin: true,
          isActive: true,
          orgUnitId: true,
          writesActivities: true,
          isScored: true,
          canAppreciate: true,
          canViewReports: true,
          canViewScoreReports: true,
        },
      });

      if (!mevcut?.isRoot || !mevcut.isSystemAdmin || !mevcut.isActive) {
        return null;
      }

      const updated = await tx.user.update({
        where: { id: input.id },
        data: {
          orgUnitId: input.orgUnitId,
          writesActivities: input.writesActivities,
          isScored: input.isScored,
          canAppreciate: input.canAppreciate,
          canViewReports: input.canViewReports ?? mevcut.canViewReports,
          canViewScoreReports:
            input.canViewScoreReports ?? mevcut.canViewScoreReports,
        },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: updated.id,
        action: AUDIT_ACTIONS.userUpdated,
        detail: {
          rootSelfUpdate: true,
          before: {
            orgUnitId: mevcut.orgUnitId,
            writesActivities: mevcut.writesActivities,
            isScored: mevcut.isScored,
            canAppreciate: mevcut.canAppreciate,
            canViewReports: mevcut.canViewReports,
            canViewScoreReports: mevcut.canViewScoreReports,
          },
          after: {
            orgUnitId: updated.orgUnitId,
            writesActivities: updated.writesActivities,
            isScored: updated.isScored,
            canAppreciate: updated.canAppreciate,
            canViewReports: updated.canViewReports,
            canViewScoreReports: updated.canViewScoreReports,
          },
        },
        now,
      });

      return updated;
    });

    return user ? { ok: true, user } : fail("root_protected");
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export type SetPasswordResult =
  | { ok: true; revokedSessionCount: number }
  | { ok: false; error: "user_not_found" | "root_protected"; message: string };

/**
 * Sistem yöneticisi bir kullanıcının parolasını belirler (§15.1, §15.3).
 * Mevcut parola sorulmaz — kullanıcı zaten unuttuğu için buraya gelinir.
 *
 * Değişim kullanıcının **tüm oturumlarını kapatır** ve kimlik kuşağını
 * ilerletir: bu andan önce doğan her oturum, iptalden kaçmış olsa bile
 * geçersizleşir. Bekleyen parola sıfırlama bağlantıları da böylece ölür.
 */
export async function setUserPassword(
  db: UpdateUserDb,
  userId: string,
  newPassword: string,
  now: Date,
  actorId: string | null = null,
): Promise<SetPasswordResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isRoot: true },
  });

  if (!user) {
    return { ok: false, error: "user_not_found", message: MESSAGES.user_not_found };
  }
  if (user.isRoot) {
    return { ok: false, error: "root_protected", message: MESSAGES.root_protected };
  }

  const passwordHash = await hashPassword(newPassword);

  return db.$transaction(async (tx) => {
    await tx.userCredential.upsert({
      where: { userId },
      update: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        version: { increment: 1 },
        // Yönetici parola verdiyse kilit de açılır; aksi hâlde kullanıcı yeni
        // parolasıyla da giremezdi.
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: { userId, passwordHash, passwordChangedAt: now },
    });

    const revokedSessionCount = await revokeAllUserSessions(tx, userId, now);

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.user,
      objectId: userId,
      action: AUDIT_ACTIONS.userPasswordSet,
      // Parolanın kendisi kayda geçmez; yalnız işlemin olduğu ve etkisi.
      detail: { revokedSessionCount },
      now,
    });

    return { ok: true as const, revokedSessionCount };
  });
}

/** Pasifleştirme öncesi ek koruma: kişi kendini pasifleştiremez. */
export async function canDeactivate(
  db: Pick<PrismaClient, "user">,
  actorId: string,
  targetId: string,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  if (actorId === targetId) {
    return {
      allowed: false,
      message:
        "Kendi hesabınızı pasifleştiremezsiniz; başka bir sistem yöneticisi yapmalı.",
    };
  }

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { isSystemAdmin: true, isActive: true, isRoot: true },
  });

  if (target?.isRoot) {
    return { allowed: false, message: MESSAGES.root_protected };
  }

  if (target?.isSystemAdmin && target.isActive && (await isLastSystemAdmin(db, targetId))) {
    return { allowed: false, message: MESSAGES.last_system_admin };
  }

  return { allowed: true };
}
