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

import { ORG_TREE_LOCK_KEY } from "../org/locks";



// tekrarlanmaz.
//




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
  | {
      ok: false;
      error: CreateUserErrorCode;
      message: string;
      messageKey?: string;
      messageValues?: Record<string, string | number>;
    };

const MESSAGES: Record<CreateUserErrorCode, string> = {
  out_of_scope: "You do not have permission to add users to this unit.",
  duplicate_email: "This email address is already registered.",
  email_domain_not_allowed: "An account cannot be created for this email domain.",
  unit_not_found: "The selected unit was not found.",
  inactive_unit: "An active user cannot be assigned to an inactive unit.",
  unknown: "The user could not be created.",
};


class ScopeError extends Error {}

function fail(error: CreateUserErrorCode) {
  return { ok: false as const, error, message: MESSAGES[error] };
}

function translateDatabaseError(error: unknown) {


  if (isUniqueViolation(error)) {


    // Both managers can reach the same decision path concurrently.
    return fail("duplicate_email");
  }

  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_unit");
  }

  return fail("unknown");
}

export async function createUser(
  db: CreateUserDb,



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

  actorId: string | null = null,
  now: Date = new Date(),

  options: {
    welcomeEmail?: boolean;
    secret?: string;

    root?: boolean;

    managerScope?: { actorId: string };
  } = {},
): Promise<CreateUserResult> {
  const unit = await db.orgUnit.findUnique({
    where: { id: input.orgUnitId },
    select: { isActive: true },
  });

  if (!unit) return fail("unit_not_found");
  if (!unit.isActive) return fail("inactive_unit");

  const allowedDomains = await readAllowedEmailDomains(db);
  if (!isEmailDomainAllowed(input.email, allowedDomains)) {
    return {
      ok: false as const,
      error: "email_domain_not_allowed" as const,
      message: `Accounts may only be created for these domains: ${allowedDomains.join(", ")}`,
      messageKey: "errors.user.emailDomainNotAllowedWithList",
      messageValues: { domains: allowedDomains.join(", ") || "an allowed domain" },
    };
  }

  const passwordHash = await hashPassword(input.initialPassword);

  try {
    // Create the user and credential together: a user without a password
    // cannot sign in and would leave an unusable partial record.
    const user = await db.$transaction(async (tx) => {
      if (options.managerScope) {
        // Acquire the tree lock **before the check**: triggers that move a
        // unit use the same lock, so a move waits until this operation ends.
        // `$executeRaw` is used because the lock statement returns `void` and
        // `$queryRaw` cannot decode it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_TREE_LOCK_KEY}))`;

        const inScope = await tx.$queryRaw<{ isInScope: boolean }[]>`
          SELECT EXISTS (
            WITH RECURSIVE subtree(id) AS (
              SELECT actor."orgUnitId"
              FROM "User" actor
              WHERE actor."id" = ${options.managerScope.actorId}
                AND actor."isActive"
                AND actor."isUnitManager"
              UNION ALL
              SELECT unit."id"
              FROM "OrgUnit" unit
              JOIN subtree ON unit."parentId" = subtree.id
            )
            SELECT 1 FROM subtree WHERE subtree.id = ${input.orgUnitId}
          ) AS "isInScope"
        `;

        if (!inScope[0]?.isInScope) throw new ScopeError();
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
        // Passwords never enter the audit record (§15.3).
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
