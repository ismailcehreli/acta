"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { AuthorizationError, requireSystemAdmin } from "@/server/authz/admin";
import { canManageUser, manageableUnitIds } from "@/server/authz/unit-admin";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { sendPasswordResetForUser } from "@/server/auth/reset";
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  recordAudit,
} from "@/server/audit/log";
import { sendWelcomeEmail } from "@/server/auth/reset";
import { createUser } from "@/server/users/create";
import { deactivateUser, reactivateUser } from "@/server/users/deactivate";
import {
  canDeactivate,
  setUserPassword,
  updateRootSelf,
  updateUser,
  updateUserByManager,
} from "@/server/users/update";
import { closeOpenConversationsForUser } from "@/server/conversations/close-for-deactivation";
import {
  closeConversationsForUserSchema,
  createUserSchema,
  deactivateUserSchema,
  managerCreateUserSchema,
  managerUpdateUserSchema,
  rootSelfUpdateSchema,
  setUserPasswordSchema,
  updateUserSchema,
} from "@/shared/schemas/user";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";

import type { UserFormState } from "./form-state";


async function requireUserManager() {
  const t = await getTranslations();
  const me = await getCurrentUser();
  if (!me) throw new AuthorizationError(t("auth.sessionNotFound"));

  if (!me.isSystemAdmin && !me.isUnitManager) {
    throw new AuthorizationError(t("screens.users.newPermission"));
  }

  return me;
}

/** Target user management permission; returns form error if unauthorized. */
async function validateScope(
  actorId: string,
  targetId: string,
): Promise<UserFormState | null> {
  if (await canManageUser(prisma, actorId, targetId)) return null;
  const t = await getTranslations();

  return {
    error: t("screens.users.permissionManage"),
    success: null,
    blockers: null,
  };
}

function refreshUserPages(userId?: string): void {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

/**
 * Temporary password for account created by manager.
 *
 * Never displayed to anyone and never logged anywhere; exists solely to ensure
 * account does not remain passwordless. The user sets their own password via the
 * link sent to their email.
 */
function generateRandomInitialPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Department manager user update: full name and title only.
 *
 * Other fields are not even read — `managerUpdateUserSchema` accepts three fields,
 * `updateUserByManager` fetches the rest from the database.
 */
async function managerUpdateUser(
  actorId: string,
  formData: FormData,
): Promise<UserFormState> {
  const t = await getTranslations();
  const parsed = managerUpdateUserSchema.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    title: formData.get("title"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  const scopeError = await validateScope(actorId, parsed.data.id);
  if (scopeError) return scopeError;

  // Scope list is **not carried**: only the actor ID is passed to the service
  // and computed inside the write statement according to the current tree.
  // The `validateScope` check above is only for an early and clear response;
  // the authoritative check lives in the service.
  const result = await updateUserByManager(prisma, parsed.data, actorId);
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "user", result),
      success: null,
      blockers: null,
    };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: t("screens.users.updated", { user: result.user.fullName }),
    blockers: null,
  };
}

/**
 * Department manager adding staff member.
 *
 * Manager only provides identity and destination unit; **flags and roles
 * are determined by the server.**
 */
async function managerCreateUser(
  actorId: string,
  formData: FormData,
): Promise<UserFormState> {
  const t = await getTranslations();
  const parsed = managerCreateUserSchema.safeParse({
    fullName: formData.get("fullName"),
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  // Scope is validated in the service within the transaction:
  // computing and passing it here would risk staleness if the tree changed in between.
  const result = await createUser(
    prisma,
    {
      ...parsed.data,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      isScored: true,
      canAppreciate: false,
      canViewReports: false,
      canViewScoreReports: false,
      initialPassword: generateRandomInitialPassword(),
    },
    actorId,
    new Date(),
    { welcomeEmail: true, managerScope: { actorId } },
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "user", result),
      success: null,
      blockers: null,
    };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: t("screens.users.addedWithPasswordLink", {
      user: result.user.fullName,
    }),
    blockers: null,
  };
}

export async function createUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();
  const t = await getTranslations();

  if (!me.isSystemAdmin) {
    return managerCreateUser(me.id, formData);
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    // Read the title so the manager form does not silently discard it.
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
    isUnitManager: formData.get("isUnitManager") === "on",
    isSystemAdmin: formData.get("isSystemAdmin") === "on",
    writesActivities: formData.get("writesActivities") === "on",
    // An unchecked checkbox sends nothing; compare explicitly with "on".
    isScored: formData.get("isScored") === "on",
    canAppreciate: formData.get("canAppreciate") === "on",
    canViewReports: formData.get("canViewReports") === "on",
    canViewScoreReports: formData.get("canViewScoreReports") === "on",
    // A manager cannot choose a password. The user sets it through the
    // password setup link sent to their own email address.
    initialPassword: formData.get("initialPassword"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  // The unit selector is narrowed in the UI, but the server validates the
  // manager's scope again because requests can be crafted manually.
  const manageableUnits = await manageableUnitIds(prisma, me.id);
  if (!manageableUnits.includes(parsed.data.orgUnitId)) {
    return {
      error: t("screens.users.permissionAddToUnit"),
      success: null,
      blockers: null,
    };
  }

  const result = await createUser(prisma, parsed.data, me.id);

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "user", result),
      success: null,
      blockers: null,
    };
  }

  // Welcome email is optional. Passwords are never sent by email; the user
  // receives a link and sets their own password.
  let emailNote = t("screens.users.initialPasswordReminder");

  if (formData.get("sendWelcome") === "on") {
    const emailResult = await sendWelcomeEmail(prisma, result.user.id, new Date());

    emailNote = emailResult.ok
      ? t("screens.users.welcomeEmailSent")
      : t("screens.users.welcomeEmailFailed");
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: `${result.user.fullName}: ${emailNote}`,
    blockers: null,
  };
}

export async function deactivateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();
  const t = await getTranslations();

  const parsed = deactivateUserSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: t("screens.users.invalidUser"), success: null, blockers: null };
  }

  // The actor's own account skips the scope check so the error can explain
  // that self-deactivation is not allowed rather than only saying access is denied.
  if (parsed.data.id !== me.id) {
    const scopeError = await validateScope(me.id, parsed.data.id);
    if (scopeError) return scopeError;
  }

  // Two irreversible cases: deactivating oneself and closing the last system
  // admin. Both would leave the system unmanageable.
  const permission = await canDeactivate(prisma, me.id, parsed.data.id);
  if (!permission.allowed) {
    return {
      error: localizeServiceMessage(t, "user", permission),
      success: null,
      blockers: null,
    };
  }

  const result = await deactivateUser(prisma, parsed.data.id, new Date(), me.id);

  if (!result.ok) {
    if (result.reason === "user_not_found") {
      return { error: t("screens.users.userNotFound"), success: null, blockers: null };
    }
    if (result.reason === "root_protected") {
      return {
        error: t("screens.users.rootProtected"),
        success: null,
        blockers: null,
      };
    }

    return {
      error:
        t("screens.users.openWorkBlock"),
      success: null,
      blockers: result.blockers,
    };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: t("screens.users.deactivated", { user: result.user.fullName }),
    blockers: null,
  };
}

export async function reactivateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();
  const t = await getTranslations();

  const parsed = deactivateUserSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: t("screens.users.invalidUser"), success: null, blockers: null };
  }

  const scopeError = await validateScope(me.id, parsed.data.id);
  if (scopeError) return scopeError;

  const result = await reactivateUser(prisma, parsed.data.id, new Date(), me.id);

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      user_not_found: t("screens.users.userNotFound"),
      already_active: t("screens.users.alreadyActive"),
      inactive_org_unit:
        t("screens.users.inactiveUnit"),
    };

    return { error: messages[result.reason], success: null, blockers: null };
  }

  refreshUserPages(parsed.data.id);
  return {
    error: null,
    // Explain that manager access and the password are not restored automatically.
    success: t("screens.users.reactivated", { user: result.user.fullName }),
    blockers: null,
  };
}

/**
 * Close open conversations with a reason before deactivation (§9.3).
 * This is a separate step so the administrator explicitly reviews what will
 * be closed before confirming the account change.
 */
export async function closeConversationsForUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireSystemAdmin();
  const me = await getCurrentUser();
  const t = await getTranslations();
  if (!me) return { error: t("auth.sessionNotFound"), success: null, blockers: null };

  const parsed = closeConversationsForUserSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  if (!(await canManageUser(prisma, me.id, parsed.data.id))) {
    return {
      error: t("screens.users.permissionManage"),
      success: null,
      blockers: null,
    };
  }

  const outcome = await closeOpenConversationsForUser(
    prisma,
    { id: me.id, isSystemAdmin: me.isSystemAdmin },
    parsed.data.id,
    parsed.data.reason,
    new Date(),
  );

  refreshUserPages(parsed.data.id);

  // Do not hide partial success: remaining open conversations still block
  // deactivation and must remain visible to the administrator.
  if (outcome.failed > 0) {
    return {
      error: t("screens.users.partialConversationClose", {
        closed: outcome.closed,
        failed: outcome.failed,
      }),
      success: null,
      blockers: null,
    };
  }

  return {
    error: null,
    success:
      outcome.closed === 0
        ? t("screens.users.noOpenConversations")
        : t("screens.users.conversationsClosed", { count: outcome.closed }),
    blockers: null,
  };
}

export async function updateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();
  const t = await getTranslations();

  // Managers and system administrators use separate input paths so a manager
  // never receives or submits fields outside the manager update contract.
  if (!me.isSystemAdmin) {
    return managerUpdateUser(me.id, formData);
  }

  if (me.isRoot && String(formData.get("id") ?? "") === me.id) {
    const rootParsed = rootSelfUpdateSchema.safeParse({
      id: formData.get("id"),
      orgUnitId: formData.get("orgUnitId"),
      writesActivities: formData.get("writesActivities") === "on",
      isScored: formData.get("isScored") === "on",
      canAppreciate: formData.get("canAppreciate") === "on",
      canViewReports: formData.get("canViewReports") === "on",
      canViewScoreReports: formData.get("canViewScoreReports") === "on",
    });

    if (!rootParsed.success) {
      return {
        error: localizeValidationIssue(t, rootParsed.error.issues[0]),
        success: null,
        blockers: null,
      };
    }

    const result = await updateRootSelf(prisma, rootParsed.data, me.id);
    if (!result.ok) {
      return {
        error: localizeServiceMessage(t, "user", result),
        success: null,
        blockers: null,
      };
    }

    refreshUserPages(me.id);
    return {
      error: null,
      success: t("screens.users.rootSettingsUpdated"),
      blockers: null,
    };
  }

  const parsed = updateUserSchema.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    title: formData.get("title"),
    email: formData.get("email"),
    orgUnitId: formData.get("orgUnitId"),
    isUnitManager: formData.get("isUnitManager") === "on",
    isSystemAdmin: formData.get("isSystemAdmin") === "on",
    writesActivities: formData.get("writesActivities") === "on",
    isScored: formData.get("isScored") === "on",
    canAppreciate: formData.get("canAppreciate") === "on",
    canViewReports: formData.get("canViewReports") === "on",
    canViewScoreReports: formData.get("canViewScoreReports") === "on",
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  const scopeError = await validateScope(me.id, parsed.data.id);
  if (scopeError) return scopeError;

  // Manager cannot move user to another unit: destination unit may be outside
  // their tree and moving is an org tree decision.
  const manageableUnits = await manageableUnitIds(prisma, me.id);
  if (!manageableUnits.includes(parsed.data.orgUnitId)) {
    return {
      error: t("screens.users.unitPermission"),
      success: null,
      blockers: null,
    };
  }

  const result = await updateUser(prisma, parsed.data, me.id);
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "user", result),
      success: null,
      blockers: null,
    };
  }

  refreshUserPages(result.user.id);
  return {
    error: null,
    success: t("screens.users.updated", { user: result.user.fullName }),
    blockers: null,
  };
}

/**
 * System admin sets a new password for a user. Current password is not requested:
 * this action is invoked because the user forgot their password (§15.1).
 */
export async function setUserPasswordAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = setUserPasswordSchema.safeParse({
    id: formData.get("id"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
      blockers: null,
    };
  }

  const scopeError = await validateScope(me.id, parsed.data.id);
  if (scopeError) return scopeError;

  const result = await setUserPassword(
    prisma,
    parsed.data.id,
    parsed.data.newPassword,
    new Date(),
    me.id,
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "user", result),
      success: null,
      blockers: null,
    };
  }

  refreshUserPages(parsed.data.id);
  return {
    error: null,
    success: t("screens.users.passwordChanged", {
      count: result.revokedSessionCount,
    }),
    blockers: null,
  };
}

/**
 * Sends a password reset link (Task 11.7).
 *
 * Triggered by unit manager or system admin. Password **does not change**;
 * link goes to staff member's own email and user sets password themselves.
 */
export async function triggerPasswordResetAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const me = await requireUserManager();
  const t = await getTranslations();

  const targetId = String(formData.get("id") ?? "");
  const scopeError = await validateScope(me.id, targetId);
  if (scopeError) return scopeError;

  const result = await sendPasswordResetForUser(prisma, targetId, new Date());
  if (!result.ok) {
    return {
      error: t("screens.users.resetLinkFailed"),
      success: null,
      blockers: null,
    };
  }

  await recordAudit(prisma, {
    userId: me.id,
    objectType: AUDIT_OBJECTS.user,
    objectId: targetId,
    action: AUDIT_ACTIONS.userUpdated,
    detail: { operation: "password_reset_link_sent" },
    now: new Date(),
  });

  refreshUserPages(targetId);
  return {
    error: null,
    success: t("screens.users.resetLinkSent"),
    blockers: null,
  };
}
