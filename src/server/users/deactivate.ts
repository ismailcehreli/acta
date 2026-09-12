import type { PrismaClient, User } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { revokeAllUserSessions } from "@/server/auth/session";
import { ORG_TREE_LOCK_KEY } from "@/server/org/locks";
import { resolveManager } from "@/server/org/resolve-manager";



//




export type DeactivateUserDb = Pick<
  PrismaClient,
  "user" | "orgUnit" | "conversation" | "session" | "auditLog"
>;


export type DeactivateUserRootDb = DeactivateUserDb &
  Pick<PrismaClient, "$transaction" | "$executeRaw">;

export interface DeactivationBlockers {

  openConversationCount: number;

  subordinates: { id: string; fullName: string }[];
}

export type DeactivateUserResult =
  | { ok: true; user: User; revokedSessionCount: number }
  | { ok: false; reason: "user_not_found" }
  | { ok: false; reason: "root_protected" }
  | { ok: false; reason: "blocked"; blockers: DeactivationBlockers };


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


export async function deactivateUser(
  db: DeactivateUserRootDb,
  userId: string,
  now: Date,
  actorId: string | null = null,
): Promise<DeactivateUserResult> {
  return db.$transaction(async (tx) => {

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_TREE_LOCK_KEY}))`;

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


        isUnitManager: false,
      },
    });


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


export async function reactivateUser(
  db: DeactivateUserRootDb,
  userId: string,
  now: Date,
  actorId: string | null = null,
): Promise<ReactivateUserResult> {
  return db.$transaction(async (tx) => {

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_TREE_LOCK_KEY}))`;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, orgUnit: { select: { isActive: true } } },
    });

    if (!user) return { ok: false, reason: "user_not_found" };
    if (user.isActive) return { ok: false, reason: "already_active" };


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
