"use server";

import { redirect } from "next/navigation";

import { clearSessionCookie } from "@/server/auth/cookies";
import { getCurrentUser } from "@/server/auth/current-user";
import { changePassword } from "@/server/auth/change-password";
import { prisma } from "@/server/db";
import { changePasswordSchema } from "@/shared/schemas/auth";
import { localizeValidationIssue } from "@/shared/i18n/message";
import { getTranslations } from "@/server/i18n/server";

import type { PasswordFormState } from "./form-state";

export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordRepeat: formData.get("newPasswordRepeat"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await changePassword(
    { db: prisma, now: new Date() },
    {
      userId: user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    },
  );

  if (!result.ok) {
    if (result.reason === "conflict") {
      return {
        error: t("auth.passwordChangedElsewhere"),
      };
    }

    return { error: t("auth.passwordCurrentInvalid") };
  }

  await clearSessionCookie();
  redirect("/login?passwordChanged=1");
}
