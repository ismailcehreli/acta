import type { PrismaClient, User } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

import { hashPassword } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { isEmailDomainAllowed } from "@/server/settings/email-domains";
import { readAllowedEmailDomains } from "@/server/settings/system-settings";


//



//




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
  | {
      ok: false;
      error: UpdateUserErrorCode;
      message: string;
      messageKey?: string;
      messageValues?: Record<string, string | number>;
    };

const MESSAGES: Record<UpdateUserErrorCode, string> = {
  user_not_found: "User not found.",
  duplicate_email: "This email address is already used by another user.",
  email_domain_not_allowed: "This email domain is not allowed.",
  unit_not_found: "The selected unit was not found.",
  inactive_unit: "An active user cannot be assigned to an inactive unit.",
  last_system_admin:
    "The last system administrator cannot be removed; assign another administrator first.",
  root_protected:
    "The root administrator account is protected; perform this action on another user.",
  unknown: "The user could not be updated.",
};

function fail(error: UpdateUserErrorCode): UpdateUserResult {
  return { ok: false, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown): UpdateUserResult {
  // Uniqueness is translated from the **error code** (see
  // `src/server/db-errors.ts`).
  if (isUniqueViolation(error)) {


    return fail("duplicate_email");
  }

  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_unit");
  }



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

  title?: string | null;
  email: string;
  orgUnitId: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  writesActivities: boolean;

  isScored?: boolean;

  canAppreciate?: boolean;

  canViewReports?: boolean;

  canViewScoreReports?: boolean;
}


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


async function isLastSystemAdmin(
  db: Pick<PrismaClient, "user">,
  userId: string,
): Promise<boolean> {
  const otherAdmins = await db.user.count({
    where: { isSystemAdmin: true, isActive: true, id: { not: userId } },
  });

  return otherAdmins === 0;
}


export async function updateUserByManager(
  db: UpdateUserDb,
  input: ManagerUpdateUserInput,
  actorId: string,
  now: Date = new Date(),
): Promise<UpdateUserResult> {
  try {
    return await db.$transaction(async (tx) => {



      const lockedUser = await tx.$queryRaw<
        { fullName: string; title: string | null }[]
      >`SELECT "fullName", "title" FROM "User" WHERE "id" = ${input.id} FOR UPDATE`;

      const existingUser = lockedUser[0];
      if (!existingUser) return fail("user_not_found");

      // **All authorization is inside the write statement.** Previously a
      // scope list was calculated first and passed to the service as an
      // authorization token. If the target's unit left the manager's branch
      // between the two steps, the stale list still allowed the write
      // (23.08.2026, third audit round). Combining the check and write removes
      // that race window.
      //
      // The statement verifies five conditions at once: the actor is active,
      // remains a unit manager, the target is not the actor, the target is not
      // a system administrator, and the target's unit is in the actor's
      // **current** subtree.
      const updatedRows = await tx.$executeRaw`
        UPDATE "User" AS target
        SET "fullName" = ${input.fullName},
            "title" = ${input.title ?? null},
            "updatedAt" = ${now}
        WHERE target."id" = ${input.id}
          -- A manager cannot manage their own account through this path.
          -- The actor's record is in their own subtree, so the scope check
          -- alone would not prevent it; this is a direct service boundary.
          AND target."id" <> ${actorId}
          AND target."isSystemAdmin" = FALSE
          AND EXISTS (
            WITH RECURSIVE subtree(id) AS (
              SELECT actor."orgUnitId"
              FROM "User" actor
              WHERE actor."id" = ${actorId}
                AND actor."isActive"
                AND actor."isUnitManager"
              UNION ALL
              SELECT unit."id"
              FROM "OrgUnit" unit
              JOIN subtree ON unit."parentId" = subtree.id
            )
            SELECT 1 FROM subtree WHERE subtree.id = target."orgUnitId"
          )
      `;

      // "Exists but unauthorized" and "not found" receive the same response
      // (§15.1).
      if (updatedRows === 0) return fail("user_not_found");

      const current = await tx.user.findUniqueOrThrow({ where: { id: input.id } });

      // The audit record carries the **changed fields**. The previous version
      // recorded before/after email, unit, and flags only; the manager path
      // never changed those fields, so its record identified who edited whom
      // but not what changed.
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: current.id,
        action: AUDIT_ACTIONS.userUpdated,
        detail: {
          before: { fullName: existingUser.fullName, title: existingUser.title },
          after: { fullName: current.fullName, title: current.title },
        },
        now,
      });

      return { ok: true as const, user: current };
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
  const existingUser = await db.user.findUnique({ where: { id: input.id } });
  if (!existingUser) return fail("user_not_found");
  if (existingUser.isRoot) return fail("root_protected");

  const unit = await db.orgUnit.findUnique({
    where: { id: input.orgUnitId },
    select: { isActive: true },
  });
  if (!unit) return fail("unit_not_found");
  if (!unit.isActive && existingUser.isActive) return fail("inactive_unit");

  // Apply the restriction only to a **changed** address. Adding the
  // restriction later must not make existing users impossible to edit.
  if (input.email !== existingUser.email) {
    const allowedDomains = await readAllowedEmailDomains(db);
    if (!isEmailDomainAllowed(input.email, allowedDomains)) {
      return {
        ok: false,
        error: "email_domain_not_allowed",
        message: `The address may only use these domains: ${allowedDomains.join(", ")}`,
        messageKey: "errors.user.emailDomainUpdateNotAllowedWithList",
        messageValues: { domains: allowedDomains.join(", ") || "an allowed domain" },
      };
    }
  }

  // Early validation gives the user a prompt, understandable response. The
  // database trigger (`User_keep_system_admin`) remains authoritative because
  // this unlocked count cannot see a concurrent update (audit 21.08.2026,
  // finding 6).
  if (
    existingUser.isSystemAdmin &&
    !input.isSystemAdmin &&
    existingUser.isActive &&
    (await isLastSystemAdmin(db, input.id))
  ) {
    return fail("last_system_admin");
  }

  try {
    const user = await db.$transaction(async (tx) => {
      const current = await tx.user.update({
        where: { id: input.id },
        data: {
          fullName: input.fullName,
          title: input.title ?? null,
          // Email is an attribute; the internal identity is independent of it
          // (§15.3).
          email: input.email.trim().toLowerCase(),
          orgUnitId: input.orgUnitId,
          isUnitManager: input.isUnitManager,
          isSystemAdmin: input.isSystemAdmin,
          writesActivities: input.writesActivities,
          // Omitted fields remain unchanged: the unit manager form does not
          // include them.
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

      // Record before and after values so permission changes are visible
      // separately (§15.2).
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.user,
        objectId: current.id,
        action: AUDIT_ACTIONS.userUpdated,
        detail: {
          before: {
            email: existingUser.email,
            orgUnitId: existingUser.orgUnitId,
            isUnitManager: existingUser.isUnitManager,
            isSystemAdmin: existingUser.isSystemAdmin,
            writesActivities: existingUser.writesActivities,
            canViewReports: existingUser.canViewReports,
            canViewScoreReports: existingUser.canViewScoreReports,
          },
          after: {
            email: current.email,
            orgUnitId: current.orgUnitId,
            isUnitManager: current.isUnitManager,
            isSystemAdmin: current.isSystemAdmin,
            writesActivities: current.writesActivities,
            canViewReports: current.canViewReports,
            canViewScoreReports: current.canViewScoreReports,
          },
        },
        now,
      });

      return current;
    });

    return { ok: true, user };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Operational fields explicitly allowed for the root account itself. */
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
      const existingUser = await tx.user.findUnique({
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

      if (!existingUser?.isRoot || !existingUser.isSystemAdmin || !existingUser.isActive) {
        return null;
      }

      const updated = await tx.user.update({
        where: { id: input.id },
        data: {
          orgUnitId: input.orgUnitId,
          writesActivities: input.writesActivities,
          isScored: input.isScored,
          canAppreciate: input.canAppreciate,
          canViewReports: input.canViewReports ?? existingUser.canViewReports,
          canViewScoreReports:
            input.canViewScoreReports ?? existingUser.canViewScoreReports,
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
            orgUnitId: existingUser.orgUnitId,
            writesActivities: existingUser.writesActivities,
            isScored: existingUser.isScored,
            canAppreciate: existingUser.canAppreciate,
            canViewReports: existingUser.canViewReports,
            canViewScoreReports: existingUser.canViewScoreReports,
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
 * A system administrator sets a user's password (§15.1, §15.3).
 * The current password is not requested because this path is for forgotten
 * passwords.
 *
 * The change **revokes all sessions** and increments the credential version:
 * every session issued before this moment becomes invalid, even if it escaped
 * explicit revocation. Pending password-reset links also become invalid.
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
        // Setting a password also unlocks the account; otherwise the user could
        // not sign in with the new password.
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
      // The password itself is never recorded; only the operation and its
      // effect are audited.
      detail: { revokedSessionCount },
      now,
    });

    return { ok: true as const, revokedSessionCount };
  });
}

/** Additional deactivation guard: a person cannot deactivate themselves. */
export async function canDeactivate(
  db: Pick<PrismaClient, "user">,
  actorId: string,
  targetId: string,
): Promise<
  | { allowed: true }
  | {
      allowed: false;
      error: "cannot_deactivate_self" | "root_protected" | "last_system_admin";
      message: string;
    }
> {
  if (actorId === targetId) {
    return {
      allowed: false,
      error: "cannot_deactivate_self",
      message:
        "You cannot deactivate your own account; another system administrator must do it.",
    };
  }

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { isSystemAdmin: true, isActive: true, isRoot: true },
  });

  if (target?.isRoot) {
    return {
      allowed: false,
      error: "root_protected",
      message: MESSAGES.root_protected,
    };
  }

  if (target?.isSystemAdmin && target.isActive && (await isLastSystemAdmin(db, targetId))) {
    return {
      allowed: false,
      error: "last_system_admin",
      message: MESSAGES.last_system_admin,
    };
  }

  return { allowed: true };
}
