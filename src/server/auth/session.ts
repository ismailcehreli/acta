import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import { SESSION_HOURS } from "./config";






export type SessionDb = Pick<PrismaClient, "session" | "systemSetting">;


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


export function tokenHashEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}


export function sessionExpiry(now: Date, hours = SESSION_HOURS): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export interface CreatedSession {

  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  db: SessionDb,
  userId: string,
  now: Date,
  credentialVersion = 0,

  sessionHours?: number,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const effectiveSessionHours =
    sessionHours ?? (await readNumericSetting(db, SETTING_KEYS.sessionHours));
  const expiresAt = sessionExpiry(now, effectiveSessionHours);

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


export async function createSessionIfCredentialUnchanged(
  db: SessionWriteDb,
  userId: string,
  expectedVersion: number,
  now: Date,

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
 * Validates a session token. A revoked, expired, or inactive user's session is
 * invalid; a deactivated user cannot remain in the system through an open
 * session.
 *
 * Sessions created under an older credential version are also invalid. Bulk
 * revocation alone is insufficient: a session created immediately after the
 * revocation could escape it. Comparing credential versions closes that gap.
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

  // A password change increments the version; sessions from the old version
  // are invalid.
  const currentVersion = session.user.credential?.version;
  if (currentVersion !== undefined && session.credentialVersion !== currentVersion) {
    return null;
  }

  return { sessionId: session.id, userId: session.userId };
}

/** Updates last-used time so session activity can be tracked. */
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

/** Called when a password changes or a user is deactivated (§15.3). */
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
