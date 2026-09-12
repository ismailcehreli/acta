"use server";

import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { prisma } from "@/server/db";
import { resetPasswordSchema, resetRequestSchema } from "@/shared/schemas/auth";
import { localizeValidationIssue } from "@/shared/i18n/message";
import { getTranslations } from "@/server/i18n/server";

import type { ResetFormState } from "./form-state";




export async function requestResetAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const t = await getTranslations();
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });



  if (!parsed.success) return { error: null, info: t("auth.resetLinkSent") };

  await requestPasswordReset(prisma, parsed.data.email, new Date());

  return { error: null, info: t("auth.resetLinkSent") };
}

export async function resetPasswordAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const t = await getTranslations();
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    newPasswordRepeat: formData.get("newPasswordRepeat"),
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      info: null,
    };
  }

  const result = await resetPassword(
    prisma,
    parsed.data.token,
    parsed.data.newPassword,
    new Date(),
  );

  if (!result.ok) {
    const message =
      result.reason === "expired_token"
        ? t("auth.resetLinkExpired")
        : result.reason === "used_token"
          ? t("auth.resetLinkUsed")
          : t("auth.resetLinkInvalid");

    return { error: message, info: null };
  }

  return {
    error: null,
    info: t("auth.resetSuccess"),
  };
}
