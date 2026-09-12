"use server";

import { revalidatePath } from "next/cache";

import {
  approveActivity,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  approveActivitySchema,
  rejectActivitySchema,
  requestChangesSchema,
} from "@/shared/schemas/approval";

import { emptyActivityFormState, type ActivityFormState } from "../form-state";





export async function approveActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = approveActivitySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await approveActivity(prisma, user.id, parsed.data.id, new Date());
  if (!result.ok) return { error: localizeServiceMessage(t, "approval", result) };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}

export async function requestChangesAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = requestChangesSchema.safeParse({
    id: formData.get("id"),
    reasonId: formData.get("reasonId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await requestChanges(
    prisma,
    user.id,
    parsed.data.id,
    { reasonId: parsed.data.reasonId, note: parsed.data.note },
    new Date(),
  );
  if (!result.ok) return { error: localizeServiceMessage(t, "approval", result) };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}

/** Reject an activity; a reason category is required by the product decision. */
export async function rejectActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = rejectActivitySchema.safeParse({
    id: formData.get("id"),
    reasonId: formData.get("reasonId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await rejectActivity(
    prisma,
    user.id,
    parsed.data.id,
    { reasonId: parsed.data.reasonId, note: parsed.data.note },
    new Date(),
  );
  if (!result.ok) return { error: localizeServiceMessage(t, "approval", result) };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}
