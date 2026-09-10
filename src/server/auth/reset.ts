import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { appSecret } from "./config";
import { hashPassword } from "./password";
import { issueResetToken, verifyResetToken } from "./reset-token";
import { revokeAllUserSessions } from "./session";

// Parola sıfırlama (§15.3). E-posta üzerinden, tek kullanımlık ve süreli
// belirteçle; başarıda **tüm oturumlar iptal** edilir.
//
// İstek yolu kullanıcı numaralandırmasına izin vermez: kayıtsız e-posta, pasif
// kullanıcı ve kayıtlı kullanıcı **aynı** cevabı alır. Aksi hâlde giriş
// ekranından kimin çalıştığı öğrenilebilirdi (Görev 1.1'deki aynı kural).

export type ResetDb = Pick<
  PrismaClient,
  | "user"
  | "userCredential"
  | "notificationQueue"
  | "systemSetting"
  | "session"
  | "auditLog"
  | "$transaction"
>;

export type ResetRequestOutcome = {
  /** Belirteç üretildi mi. Dışarıya **sızdırılmaz**; günlük ve test içindir. */
  issued: boolean;
};

export async function requestPasswordReset(
  db: ResetDb,
  email: string,
  now: Date,
  secret: string = appSecret(),
): Promise<ResetRequestOutcome> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isActive: true, credential: { select: { version: true } } },
  });

  // Pasif kullanıcıya da belirteç gitmez: hesap kapalıysa parola değiştirmek
  // onu geri açmaz, ama e-postanın gitmesi hesabın var olduğunu ele verirdi.
  if (!user || !user.isActive || !user.credential) return { issued: false };

  const token = issueResetToken(user.id, user.credential.version, now, secret);

  // Belirteç kuyruk kaydının içinde durur. Kuyruğa erişebilen zaten
  // veritabanına erişiyor ve `UserCredential`'ı doğrudan değiştirebilir;
  // belirteç ek bir yetki vermiyor. Ömrü bir saatle sınırlı.
  await enqueueNotification(db, {
    userId: user.id,
    eventType: NOTIFICATION_EVENTS.passwordReset,
    payload: { token },
    // Anahtar kuşağı taşır: aynı kuşak için ikinci bir istek yeni kayıt
    // açmaz, yani "sıfırlama" düğmesine basmak posta yağmuruna dönmez.
    idempotencyKey: `password_reset:${user.id}:${user.credential.version}`,
    now,
  });

  return { issued: true };
}

/**
 * Yeni açılan hesaba "hoş geldiniz" e-postası kuyruğa yazar.
 *
 * **Parola e-postaya konmaz** (§15.3). Kullanıcıya sistemin adresi ve kendi
 * giriş adresi bildirilir; parolayı kendisi belirlesin diye sıfırlama
 * belirteci gönderilir. Parolayı postayla göndermek onu posta kutusunda,
 * yedeklerde ve arama sonuçlarında süresiz bırakırdı — sistem yöneticisinin
 * belirlediği başlangıç parolası da böylece hiç dolaşıma girmez.
 *
 * Sessiz kalmaz: hesap açıldı ama e-posta kuyruğa yazılamadıysa çağıran
 * bunu görür ve kullanıcıya söyler.
 */
export async function sendWelcomeEmail(
  db: ResetDb,
  userId: string,
  now: Date,
  secret: string = appSecret(),
): Promise<{ ok: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, credential: { select: { version: true } } },
  });

  if (!user || !user.isActive || !user.credential) return { ok: false };

  const token = issueResetToken(userId, user.credential.version, now, secret);

  await enqueueNotification(db, {
    userId,
    eventType: NOTIFICATION_EVENTS.accountCreated,
    payload: { token },
    idempotencyKey: `account_created:${userId}`,
    now,
  });

  return { ok: true };
}

/**
 * Kimliği bilinen bir kullanıcı için sıfırlama bağlantısı gönderir
 * (Görev 11.7).
 *
 * Bölüm müdürü ve sistem yöneticisi bunu tetikler. **Parola değişmez**:
 * yalnız bağlantı gider ve şifreyi kişi kendisi belirler. Müdürün belirlediği
 * bir şifre, müdürün bildiği şifredir; o andan sonra "bu kaydı kim yazdı"
 * sorusunun cevabı kesin olmaktan çıkar ve denetim izinin değeri düşer.
 *
 * `requestPasswordReset`ten ayrı: orası **e-posta** alıyor ve kullanıcı
 * numaralandırmasına karşı her durumda aynı cevabı veriyor. Burada hedef
 * zaten biliniyor; gizlenecek bir şey yok, çağıran sonucu görmeli.
 */
export async function sendPasswordResetForUser(
  db: ResetDb,
  userId: string,
  now: Date,
  secret: string = appSecret(),
): Promise<{ ok: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, credential: { select: { version: true } } },
  });

  // Pasif hesaba bağlantı gitmez: parola değiştirmek hesabı geri açmaz.
  if (!user || !user.isActive || !user.credential) return { ok: false };

  const token = issueResetToken(userId, user.credential.version, now, secret);

  await enqueueNotification(db, {
    userId,
    eventType: NOTIFICATION_EVENTS.passwordReset,
    payload: { token },
    // Kuşak anahtarda: aynı kuşakta ikinci kez tetiklenirse yeni posta
    // yazılmaz, ilk bağlantı hâlâ geçerlidir.
    idempotencyKey: `password_reset:${userId}:${user.credential.version}`,
    now,
  });

  return { ok: true };
}

export type ResetResult =
  | { ok: true; revokedSessionCount: number }
  | { ok: false; reason: "invalid_token" | "expired_token" | "used_token" };

export async function resetPassword(
  db: ResetDb,
  token: string,
  newPassword: string,
  now: Date,
  secret: string = appSecret(),
): Promise<ResetResult> {
  const verified = verifyResetToken(token, now, secret);

  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason === "expired" ? "expired_token" : "invalid_token",
    };
  }

  const passwordHash = await hashPassword(newPassword);

  const revokedSessionCount = await db.$transaction(async (tx) => {
    // Yazma **koşulludur**: kimlik satırı hâlâ belirtecin doğduğu kuşaktaysa
    // güncellenir. Kuşak ilerlemişse belirteç kullanılmış (ya da parola başka
    // bir yoldan değişmiş) demektir; ikinci kullanım buradan geri döner.
    const written = await tx.userCredential.updateMany({
      where: { userId: verified.userId, version: verified.credentialVersion },
      data: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        version: { increment: 1 },
        // Sıfırlama kilidi de açar: kilitli kullanıcı parolasını
        // sıfırlayabilmeli, yoksa kilit süresi boyunca çaresiz kalır.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (written.count === 0) return null;

    // Parola değiştiyse elde kalan oturum değişikliği anlamsız kılar (§15.3).
    const iptalEdilen = await revokeAllUserSessions(tx, verified.userId, now);

    await recordAudit(tx, {
      userId: verified.userId,
      objectType: AUDIT_OBJECTS.user,
      objectId: verified.userId,
      action: AUDIT_ACTIONS.userPasswordReset,
      detail: { revokedSessionCount: iptalEdilen },
      now,
    });

    return iptalEdilen;
  });

  if (revokedSessionCount === null) return { ok: false, reason: "used_token" };

  return { ok: true, revokedSessionCount };
}
