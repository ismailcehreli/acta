"use server";

import { revalidatePath } from "next/cache";

import {
  markNoActivityPeriod,
  cancelNoActivityPeriod,
  decideNoActivityPeriod,
} from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  absenceDecisionSchema,
  cancelAbsenceSchema,
  markAbsenceSchema,
} from "@/shared/schemas/absence";

import type { AbsenceFormState } from "./form-state";




function error(message: string): AbsenceFormState {
  return { error: message, success: null };
}

export async function markAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  const t = await getTranslations();
  if (!me) return error(t("auth.sessionNotFound"));

  const rawDeputy = formData.get("deputyId");
  const rawNote = formData.get("note");

  const parsed = markAbsenceSchema.safeParse({
    userId: formData.get("userId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    note: typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote : undefined,
    deputyId:
      typeof rawDeputy === "string" && rawDeputy !== "" ? rawDeputy : undefined,
  });

  if (!parsed.success) {
    return error(localizeValidationIssue(t, parsed.error.issues[0]));
  }

  const result = await markNoActivityPeriod(prisma, me.id, parsed.data, new Date());
  if (!result.ok) return error(localizeServiceMessage(t, "absence", result));

  revalidatePath("/team/absence");
  return {
    error: null,
    success: t("screens.teamAbsence.savedNoActivity"),
  };
}

export async function decideAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  const t = await getTranslations();
  if (!me) return error(t("auth.sessionNotFound"));

  const rawReason = formData.get("reason");
  const parsed = absenceDecisionSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    reason:
      typeof rawReason === "string" && rawReason.trim() !== ""
        ? rawReason
        : undefined,
  });
  if (!parsed.success) {
    return error(
      localizeValidationIssue(
        t,
        parsed.error.issues[0],
        "screens.teamAbsence.invalidDecision",
      ),
    );
  }

  const result = await decideNoActivityPeriod(
    prisma,
    me.id,
    parsed.data.id,
    parsed.data.decision,
    parsed.data.reason,
    new Date(),
  );
  if (!result.ok) return error(localizeServiceMessage(t, "absence", result));

  revalidatePath("/team/absence");
  revalidatePath("/absence");
  revalidatePath("/");

  return {
    error: null,
    success:
      parsed.data.decision === "APPROVED"
        ? t("screens.teamAbsence.requestApproved")
        : t("screens.teamAbsence.requestRejected"),
  };
}

export async function cancelAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  const t = await getTranslations();
  if (!me) return error(t("auth.sessionNotFound"));

  const parsed = cancelAbsenceSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return error(
      localizeValidationIssue(
        t,
        parsed.error.issues[0],
        "screens.teamAbsence.invalidCancellation",
      ),
    );
  }

  const result = await cancelNoActivityPeriod(
    prisma,
    me.id,
    parsed.data.id,
    parsed.data.reason,
  );
  if (!result.ok) return error(localizeServiceMessage(t, "absence", result));

  revalidatePath("/team/absence");
  revalidatePath("/deputy");
  return { error: null, success: t("screens.absence.recordCancelled") };
}
