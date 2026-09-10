import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import { SESSION_HOURS } from "./config";

// Oturumlar sunucu tarafında saklanır, süre sonu ve iptal edilebilirlik taşır
// (§15.3). Veritabanında belirtecin kendisi değil, özeti durur: yedek dosyası
// veya veritabanı okuması ele geçse bile oturum çalınamaz.

/**
 * Yalnızca ihtiyaç duyulan tablolar. İşlem (transaction) içindeki istemci de bu
 * tipe uyar, böylece aynı fonksiyonlar hem tek başına hem işlem içinde çalışır.
 */
export type SessionDb = Pick<PrismaClient, "session" | "systemSetting">;

/** Oturum açarken kimlik kuşağının doğrulanması için gereken erişim. */
export type SessionWriteDb = Pick<
  PrismaClient,
  "session" | "userCredential" | "$queryRaw" | "$transaction"
>;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sabit süreli karşılaştırma; özet eşleşmesi zamanlama bilgisi sızdırmasın. */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Oturumun sona erme anı. Süre sistem ayarlarından gelir (§16.5); parametre
 * verilmezse koddaki varsayılan kullanılır — saf fonksiyon veritabanına
 * dokunmaz, sahte saatle sınanabilir kalır.
 */
export function sessionExpiry(now: Date, hours = SESSION_HOURS): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export interface CreatedSession {
  /** Yalnızca burada görülür; çağıran bunu çereze yazar, veritabanına değil. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  db: SessionDb,
  userId: string,
  now: Date,
  credentialVersion = 0,
  /** Oturum ömrü (saat); verilmezse sistem ayarından okunur (§16.5). */
  sessionHours?: number,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const saat =
    sessionHours ?? (await readNumericSetting(db, SETTING_KEYS.sessionHours));
  const expiresAt = sessionExpiry(now, saat);

  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
      credentialVersion,
    },
  });

  return { token, sessionId: session.id, expiresAt };
}

/**
 * Oturumu yalnızca kimlik kuşağı beklenen değerdeyse açar.
 *
 * Kimlik satırı önce `FOR UPDATE` ile kilitlenir: parola değiştiren işlem aynı
 * satırı güncellediği için ikisi sıraya girer. Böylece "eski parolayı doğrula →
 * parola değişti → yine de oturum aç" yarışı kapanır; giriş ya değişimden önce
 * biter (ve değişim onu iptal eder) ya da değişimi görüp reddedilir.
 */
export async function createSessionIfCredentialUnchanged(
  db: SessionWriteDb,
  userId: string,
  expectedVersion: number,
  now: Date,
  /** Oturum ömrü (saat); verilmezse sistem ayarından okunur. */
  sessionHours?: number,
): Promise<CreatedSession | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "UserCredential" WHERE "userId" = ${userId} FOR UPDATE
    `;

    const current = rows[0];
    if (!current || current.version !== expectedVersion) return null;

    return createSession(tx, userId, now, expectedVersion, sessionHours);
  });
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
}

/**
 * Belirteci doğrular. İptal edilmiş, süresi geçmiş veya kullanıcısı
 * pasifleştirilmiş oturum geçersizdir — pasifleştirilen kişi elindeki açık
 * oturumla sistemde kalamaz.
 *
 * Eski kimlik kuşağında doğmuş oturumlar da geçersizdir. Toplu iptal tek başına
 * yetmez: iptal edildiği anda var olmayan, hemen sonra yazılan bir oturum
 * ondan kaçardı. Kuşak karşılaştırması bu boşluğu kapatır.
 */
export async function findActiveSession(
  db: SessionDb,
  token: string,
  now: Date,
): Promise<ActiveSession | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
          credential: { select: { version: true } },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt <= now) return null;
  if (!session.user.isActive) return null;

  // Parola değişmişse kuşak ilerlemiştir; eski kuşakta doğan oturum ölüdür.
  const currentVersion = session.user.credential?.version;
  if (currentVersion !== undefined && session.credentialVersion !== currentVersion) {
    return null;
  }

  return { sessionId: session.id, userId: session.userId };
}

/** Son kullanım zamanını taşır; oturumun canlılığını izlemeye yarar. */
export async function touchSession(
  db: SessionDb,
  sessionId: string,
  now: Date,
): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { lastUsedAt: now },
  });
}

export async function revokeSession(
  db: SessionDb,
  token: string,
  now: Date,
): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Parola değişiminde ve kullanıcı pasifleştirildiğinde çağrılır (§15.3). */
export async function revokeAllUserSessions(
  db: SessionDb,
  userId: string,
  now: Date,
): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count;
}
