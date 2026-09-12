"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { appreciateActivity } from "@/server/scoring/appreciation";
import { localizeServiceMessage } from "@/shared/i18n/message";

import type { AppreciationState } from "./appreciation-state";




export async function appreciateAction(
  _previous: AppreciationState,
  formData: FormData,
): Promise<AppreciationState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound") };

  const activityId = String(formData.get("activityId") ?? "");
  const result = await appreciateActivity(prisma, user.id, activityId, new Date());

  if (!result.ok) return { error: localizeServiceMessage(t, "appreciation", result) };

  revalidatePath(`/activities/${activityId}`);
  return { error: null };
}
