import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { hashPassword, verifyPassword } from "./password";
import { revokeAllUserSessions } from "./session";




export type ChangePasswordResult =
  | { ok: true; revokedSessionCount: number }
  | { ok: false; reason: "invalid_current_password" }

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



  //




  // (audit 2026-08-18, finding 7).
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


        version: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (written.count === 0) return null;

    const revokedSessionCount = await revokeAllUserSessions(tx, input.userId, now);

    await recordAudit(tx, {
      userId: input.userId,
      objectType: AUDIT_OBJECTS.user,
      objectId: input.userId,
      action: AUDIT_ACTIONS.userPasswordChanged,
      detail: { revokedSessionCount },
      now,
    });

    return revokedSessionCount;
  });

  if (revokedSessionCount === null) return { ok: false, reason: "conflict" };

  return { ok: true, revokedSessionCount };
}
