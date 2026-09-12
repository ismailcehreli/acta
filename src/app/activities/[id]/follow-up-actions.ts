"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  closeFollowUp,
  openFollowUp,
  reopenFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";
import {
  closeFollowUpSchema,
  openFollowUpSchema,
  reopenFollowUpSchema,
  transferFollowUpSchema,
} from "@/shared/schemas/follow-up";

import { emptyActivityFormState, type ActivityFormState } from "../form-state";




function refresh(activityId: string) {
  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/");
}

export async function openFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = openFollowUpSchema.safeParse({
    activityId: formData.get("activityId"),
    nextStep: formData.get("nextStep"),
    reviewDate: formData.get("reviewDate"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await openFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    {
      activityId: parsed.data.activityId,
      nextStep: parsed.data.nextStep || null,
      reviewDate: parsed.data.reviewDate
        ? new Date(`${parsed.data.reviewDate}T00:00:00.000Z`)
        : null,
    },
  );

  if (!result.ok) return { error: localizeServiceMessage(t, "followUp", result) };

  refresh(parsed.data.activityId);
  return emptyActivityFormState;
}

export async function closeFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = closeFollowUpSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await closeFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.note,
  );

  if (!result.ok) return { error: localizeServiceMessage(t, "followUp", result) };

  refresh(result.item.activityId);
  return emptyActivityFormState;
}

export async function reopenFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = reopenFollowUpSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await reopenFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.note,
  );

  if (!result.ok) return { error: localizeServiceMessage(t, "followUp", result) };

  refresh(result.item.activityId);
  return emptyActivityFormState;
}

export async function transferFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const parsed = transferFollowUpSchema.safeParse({
    id: formData.get("id"),
    ownerId: formData.get("ownerId"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await transferFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.ownerId,
  );

  if (!result.ok) return { error: localizeServiceMessage(t, "followUp", result) };

  refresh(result.item.activityId);
  return emptyActivityFormState;
}
