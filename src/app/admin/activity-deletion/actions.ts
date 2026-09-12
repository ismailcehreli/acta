"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  confirmActivityDeletion,
  describeActivityForDeletion,
  requestActivityDeletion,
} from "@/server/activities/delete";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { localizeServiceMessage } from "@/shared/i18n/message";
export interface DeletionFormState {
  error?: string;
  success?: string;
  waitingForCode?: boolean;
  activityId?: string;
}


function extractActivityId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return match ? match[0] : trimmed;
}

async function rootUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function searchActivityAction(
  _previous: DeletionFormState,
  formData: FormData,
): Promise<DeletionFormState> {
  const user = await rootUser();
  const t = await getTranslations();
  const activityId = extractActivityId(String(formData.get("activityId") ?? ""));

  if (activityId === "") {
    return { error: t("screens.activityDeletion.activityIdRequired") };
  }

  const result = await describeActivityForDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
  );

  if (!result.ok) {
    return { error: localizeServiceMessage(t, "deletion", result) };
  }

  redirect(`/admin/activity-deletion?record=${encodeURIComponent(result.value.id)}`);
}

export async function sendCodeAction(
  _previous: DeletionFormState,
  formData: FormData,
): Promise<DeletionFormState> {
  const user = await rootUser();
  const t = await getTranslations();
  const activityId = String(formData.get("activityId") ?? "");

  const result = await requestActivityDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
    new Date(),
  );

  if (!result.ok) {
    return { error: localizeServiceMessage(t, "deletion", result), activityId };
  }

  revalidatePath("/admin/activity-deletion");
  return {
    success: t("screens.activityDeletion.codeSent", { email: user.email }),
    waitingForCode: true,
    activityId,
  };
}

export async function deleteAction(
  _previous: DeletionFormState,
  formData: FormData,
): Promise<DeletionFormState> {
  const user = await rootUser();
  const t = await getTranslations();
  const activityId = String(formData.get("activityId") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  const result = await confirmActivityDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
    code,
    new Date(),
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "deletion", result),
      waitingForCode: true,
      activityId,
    };
  }

  // The deleted record disappeared from every view; refresh lists and counters.
  revalidatePath("/admin/activity-deletion");
  revalidatePath("/activities");
  revalidatePath("/feed");
  revalidatePath("/");

  return {
    success: t("screens.activityDeletion.deleted", {
      title: result.value.deletedTitle,
    }),
  };
}
