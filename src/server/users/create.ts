import type { PrismaClient, User } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

import { appSecret } from "@/server/auth/config";
import { hashPassword } from "@/server/auth/password";
import { issueResetToken } from "@/server/auth/reset-token";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  isEmailDomainAllowed,
} from "@/server/settings/email-domains";
import { readAllowedEmailDomains } from "@/server/settings/system-settings";
import type { CreateUserInput } from "@/shared/schemas/user";

// Kullanıcı ekleme (§4.6, §15.1). Kullanıcı ağaçta bir düğüme bağlıdır; pasif
// birime aktif kullanıcı bağlanamaz — veritabanı kısıtıdır, burada
// tekrarlanmaz.
//
// "Bir birimde en fazla bir yönetici" kısıtı 20.08.2026'da kaldırıldı: bir
// departmanda birden fazla müdür olabiliyor ve kayıt hepsinin onay kuyruğuna
// düşüyor.

export type CreateUserDb = Pick<
  PrismaClient,
  | "user"
  | "orgUnit"
  | "auditLog"
  | "systemSetting"
  | "$transaction"
  | "$queryRaw"
  | "$executeRaw"
> &
  // Hoş geldiniz bildirimi **aynı işlemde** yazılıyor; kuyruk tablosuna
  // erişimi olmayan çağıran o seçeneği kullanamaz.
  Partial<Pick<PrismaClient, "notificationQueue" | "pushSubscription">>;

export type CreateUserErrorCode =
  | "out_of_scope"
  | "duplicate_email"
  | "email_domain_not_allowed"
  | "unit_not_found"
  | "inactive_unit"
  | "unknown";

export type CreateUserResult =
  | { ok: true; user: User }
  | { ok: false; error: CreateUserErrorCode; message: string };

const MESSAGES: Record<CreateUserErrorCode, string> = {
  out_of_scope: "Bu birime kullanıcı ekleme yetkiniz yok.",
  duplicate_email: "Bu e-posta adresi zaten kayıtlı.",
  email_domain_not_allowed: "Bu e-posta alan adına hesap açılamaz.",
  unit_not_found: "Seçilen birim bulunamadı.",
  inactive_unit: "Pasif bir birime aktif kullanıcı bağlanamaz.",
  unknown: "Kullanıcı eklenemedi.",
};

/** Kapsam ihlalini işlemden dışarı taşıyan iç hata. */
class ScopeError extends Error {}

function fail(error: CreateUserErrorCode) {
  return { ok: false as const, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown) {
  // Tekillik önce sorulur ve **hata kodundan** okunur; metin aramak üretim
  // derlemesinde yanlış dalı seçiyordu (bkz. `src/server/db-errors.ts`).
  if (isUniqueViolation(error)) {
    // Geriye tek tekillik kısıtı kaldı: e-posta. "Birim başına tek yönetici"
    // kısıtı 20.08.2026'da kaldırıldı — bir departmanda birden fazla müdür
    // olabiliyor ve ikisi de onaylayabiliyor.
    return fail("duplicate_email");
  }

  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_unit");
  }

  return fail("unknown");
}

export async function createUser(
  db: CreateUserDb,
  // İki alan **opsiyonel**: kurulum betiği ve örnek veri gibi çağıranlar
  // skorlama ayrıntısını bilmek zorunda değil, varsayılanları geçerli
  // (Görev 11.10, 11.11).
  input: Omit<
    CreateUserInput,
    "isScored" | "canAppreciate" | "canViewReports" | "canViewScoreReports"
  > &
    Partial<
      Pick<
        CreateUserInput,
        "isScored" | "canAppreciate" | "canViewReports" | "canViewScoreReports"
      >
    >,
  /** İşlemi yapan sistem yöneticisi; kurulum betiğinde kimse yoktur (§15.2). */
  actorId: string | null = null,
  now: Date = new Date(),
  /**
   * Hoş geldiniz bildirimi hesapla **aynı işlemde** kuyruğa yazılsın mı?
   *
   * Müdürün açtığı hesapta parolayı kimse bilmez ve tek giriş yolu bu
   * bağlantıdır; bildirim yazılamazsa hesabın da oluşmaması gerekir. Ayrı
   * adımda yazıldığında kuyruk hatası hesabı yarım bırakıyordu: eylem hata
   * veriyor ama kullanıcı kimsenin giremediği bir hesapla veritabanında
   * kalıyordu (23.08.2026, ikinci denetim turu).
   */
  options: {
    welcomeEmail?: boolean;
    secret?: string;
    /** Yalnız ilk kurulum yolu tarafından kullanılır. */
    root?: boolean;
    /**
     * Bölüm müdürü adına ekleme: birimin aktörün **o anki** alt ağacında
     * olduğu, kaydın açıldığı işlemin içinde doğrulanır.
     *
     * Kapsam dışarıda hesaplanıp buraya liste hâlinde verilseydi, arada ağaç
     * değiştiğinde liste bayat kalırdı (23.08.2026, üçüncü denetim turu).
     * Kontrol ile ekleme arasındaki pencere ayrıca **ağaç kilidiyle**
     * kapatılıyor: birim taşıyan tetikleyiciler aynı danışma kilidini alır,
     * dolayısıyla bu işlem sürerken taşıma bekler.
     */
    managerScope?: { actorId: string };
  } = {},
): Promise<CreateUserResult> {
  const unit = await db.orgUnit.findUnique({
    where: { id: input.orgUnitId },
    select: { isActive: true },
  });

  if (!unit) return fail("unit_not_found");
  if (!unit.isActive) return fail("inactive_unit");

  const izinliler = await readAllowedEmailDomains(db);
  if (!isEmailDomainAllowed(input.email, izinliler)) {
    return {
      ok: false as const,
      error: "email_domain_not_allowed" as const,
      // Hangi alan adlarının kabul edildiği söylenir; yoksa kullanıcı
      // deneme yanılmaya mecbur kalır.
      message: `Hesap yalnız şu alan adlarıyla açılabilir: ${izinliler.join(", ")}`,
    };
  }

  const passwordHash = await hashPassword(input.initialPassword);

  try {
    // Kullanıcı ve parolası birlikte oluşur: parolasız kullanıcı giriş
    // yapamayacağı için yarım kalmış kayıt kimseye yaramaz.
    const user = await db.$transaction(async (tx) => {
      if (options.managerScope) {
        // Ağaç kilidi **kontrolden önce**: birim taşıyan tetikleyiciler aynı
        // kilidi aldığı için, bu işlem bitene kadar taşıma bekler.
        // `$executeRaw`: kilit çağrısı `void` döner ve `$queryRaw` onu
        // çözemiyor.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'))`;

        const kapsamda = await tx.$queryRaw<{ var: boolean }[]>`
          SELECT EXISTS (
            WITH RECURSIVE subtree(id) AS (
              SELECT aktor."orgUnitId"
              FROM "User" aktor
              WHERE aktor."id" = ${options.managerScope.actorId}
                AND aktor."isActive"
                AND aktor."isUnitManager"
              UNION ALL
              SELECT birim."id"
              FROM "OrgUnit" birim
              JOIN subtree ON birim."parentId" = subtree.id
            )
            SELECT 1 FROM subtree WHERE subtree.id = ${input.orgUnitId}
          ) AS "var"
        `;

        if (!kapsamda[0]?.var) throw new ScopeError();
      }

      const created = await tx.user.create({
        data: {
          fullName: input.fullName,
          title: input.title ?? null,
          email: input.email,
          orgUnitId: input.orgUnitId,
          isUnitManager: input.isUnitManager,
          isSystemAdmin: input.isSystemAdmin,
          canViewReports: input.canViewReports ?? false,
          canViewScoreReports: input.canViewScoreReports ?? false,
          isRoot: options.root ?? false,
          writesActivities: input.writesActivities,
          isScored: input.isScored ?? true,
          canAppreciate: input.canAppreciate ?? false,
        },
      });

      const kimlik = await tx.userCredential.create({
        data: { userId: created.id, passwordHash },
      });

      if (options.welcomeEmail) {
        const token = issueResetToken(
          created.id,
          kimlik.version,
          now,
          options.secret ?? appSecret(),
        );

        await enqueueNotification(tx, {
          userId: created.id,
          eventType: NOTIFICATION_EVENTS.accountCreated,
          payload: { token },
          idempotencyKey: `account_created:${created.id}`,
          now,
        });
      }

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: created.id,
        action: AUDIT_ACTIONS.userCreated,
        // Parola hiçbir biçimde kayda geçmez (§15.3).
        detail: {
          email: created.email,
          isUnitManager: created.isUnitManager,
          isSystemAdmin: created.isSystemAdmin,
          writesActivities: created.writesActivities,
        },
        now,
      });

      return created;
    });

    return { ok: true, user };
  } catch (error) {
    if (error instanceof ScopeError) return fail("out_of_scope");
    return translateDatabaseError(error);
  }
}
