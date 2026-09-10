import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { hashPassword, verifyPassword } from "./password";
import { revokeAllUserSessions } from "./session";

// Parola değişiminde kullanıcının tüm oturumları iptal edilir (§15.3): parola
// çalınmış olabilir, elde kalan açık oturum değişikliği anlamsız kılardı.

export type ChangePasswordResult =
  | { ok: true; revokedSessionCount: number }
  | { ok: false; reason: "invalid_current_password" }
  /** Aynı anda başka bir değişim tamamlandı; bu istek yazmadan geri döndü. */
  | { ok: false; reason: "conflict" };

export async function changePassword(
  deps: { db: PrismaClient; now: Date },
  input: { userId: string; currentPassword: string; newPassword: string },
): Promise<ChangePasswordResult> {
  const { db, now } = deps;

  const credential = await db.userCredential.findUnique({
    where: { userId: input.userId },
  });

  if (!credential) {
    return { ok: false, reason: "invalid_current_password" };
  }

  const currentMatches = await verifyPassword(
    credential.passwordHash,
    input.currentPassword,
  );

  if (!currentMatches) {
    return { ok: false, reason: "invalid_current_password" };
  }

  const passwordHash = await hashPassword(input.newPassword);

  // Parola ve oturumlar birlikte değişir: biri yazılıp diğeri yazılmazsa
  // kullanıcı yeni parolaya geçmiş ama eski oturumlar açık kalmış olurdu.
  //
  // Yazma **koşulludur**: kimlik satırı hâlâ doğruladığımız özeti taşıyorsa
  // güncellenir. İki değişim isteği aynı eski parolayı doğrulayıp sırayla
  // yazarsa, ikincisi birincinin sonucunu ezerdi — eski parolayı bilen biri,
  // gerçek kullanıcının yeni parolasını böyle geçersiz kılabilirdi
  // (denetim 18.08.2026, bulgu 7).
  const revokedSessionCount = await db.$transaction(async (tx) => {
    const written = await tx.userCredential.updateMany({
      where: {
        userId: input.userId,
        passwordHash: credential.passwordHash,
        version: credential.version,
      },
      data: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        // Kuşak atomik olarak ilerler: bu andan önce doğan her oturum,
        // iptalden kaçmış olsa bile geçersizleşir.
        version: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (written.count === 0) return null;

    const iptalEdilen = await revokeAllUserSessions(tx, input.userId, now);

    await recordAudit(tx, {
      userId: input.userId,
      objectType: AUDIT_OBJECTS.user,
      objectId: input.userId,
      action: AUDIT_ACTIONS.userPasswordChanged,
      detail: { revokedSessionCount: iptalEdilen },
      now,
    });

    return iptalEdilen;
  });

  if (revokedSessionCount === null) return { ok: false, reason: "conflict" };

  return { ok: true, revokedSessionCount };
}
