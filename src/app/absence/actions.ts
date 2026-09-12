"use server";

import { revalidatePath } from "next/cache";

import {
  cancelNoActivityPeriod,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { localizeServiceMessage } from "@/shared/i18n/message";

import type { AbsenceFormState } from "./form-state";


//



export async function markOwnAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound"), success: null };

  const rawDeputy = formData.get("deputyId");

  const result = await markOwnNoActivityPeriod(
    prisma,
    user.id,
    {
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      note: String(formData.get("note") ?? "") || null,
      deputyId:
        typeof rawDeputy === "string" && rawDeputy !== "" ? rawDeputy : undefined,
    },
    new Date(),
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "absence", result),
      success: null,
    };
  }

  revalidatePath("/absence");
  return {
    error: null,
    success:
      result.status === "PENDING"
        ? t("screens.absence.requestSubmitted")
        : t("screens.absence.saved"),
  };
}

export async function cancelOwnAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) return { error: t("auth.sessionNotFound"), success: null };

  const result = await cancelNoActivityPeriod(
    prisma,
    user.id,
    String(formData.get("id") ?? ""),
    String(formData.get("reason") ?? ""),
    new Date(),
  );

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "absence", result),
      success: null,
    };
  }

  revalidatePath("/absence");
  return { error: null, success: t("screens.absence.recordCancelled") };
}
