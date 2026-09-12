"use server";

import { revalidatePath } from "next/cache";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { removeAvatar, saveAvatar } from "@/server/users/avatar";
import { localizeServiceMessage } from "@/shared/i18n/message";

import type { AvatarFormState } from "./form-state";


//




//






async function actorForAvatar(targetId: string) {
  const actor = await getCurrentUser();
  if (!actor) return null;
  if (actor.id === targetId || actor.isSystemAdmin) return actor;
  return null;
}

export async function uploadAvatarAction(
  _previous: AvatarFormState,
  formData: FormData,
): Promise<AvatarFormState> {
  const t = await getTranslations();
  const targetId = String(formData.get("userId") ?? "");
  const actor = await actorForAvatar(targetId);
  if (!actor) return { error: t("screens.profile.avatarPermission"), success: null };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: t("screens.profile.avatarRequired"), success: null };
  }

  const result = await saveAvatar(
    prisma,
    targetId,
    Buffer.from(await file.arrayBuffer()),
  );
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "avatar", result),
      success: null,
    };
  }

  if (actor.id !== targetId) {
    await recordAudit(prisma, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: targetId,
      action: AUDIT_ACTIONS.userUpdated,
      detail: { field: "profile_picture", operation: "uploaded" },
      now: new Date(),
    });
  }

  revalidatePath(`/users/${targetId}`);
  revalidatePath(`/admin/users/${targetId}`);
  return {
    error: null,
    success: t("screens.profile.uploadSuccess"),
    extension: result.extension,
    stamp: Date.now(),
  };
}

export async function removeAvatarAction(
  _previous: AvatarFormState,
  formData: FormData,
): Promise<AvatarFormState> {
  const t = await getTranslations();
  const targetId = String(formData.get("userId") ?? "");
  const actor = await actorForAvatar(targetId);
  if (!actor) return { error: t("screens.profile.avatarPermission"), success: null };

  await removeAvatar(prisma, targetId);

  if (actor.id !== targetId) {
    await recordAudit(prisma, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: targetId,
      action: AUDIT_ACTIONS.userUpdated,
      detail: { field: "profile_picture", operation: "removed" },
      now: new Date(),
    });
  }

  revalidatePath(`/users/${targetId}`);
  revalidatePath(`/admin/users/${targetId}`);
  return {
    error: null,
    success: t("screens.profile.removeSuccess"),
    extension: null,
    stamp: Date.now(),
  };
}
