"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSystemAdmin } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { requestSystemReset } from "@/server/reset/service";
import { getTranslations } from "@/server/i18n/server";
import { emailSchema, passwordSchema } from "@/shared/schemas/auth";
import { fullNameSchema } from "@/shared/schemas/user";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";

import type { ResetFormState } from "./form-state";

const resetFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(200),
    bootstrapFullName: fullNameSchema,
    bootstrapEmail: emailSchema,
    bootstrapPassword: passwordSchema,
    bootstrapPasswordRepeat: z.string(),
    confirmation: z.string().trim(),
  })
  .refine((data) => data.bootstrapPassword === data.bootstrapPasswordRepeat, {
    path: ["bootstrapPasswordRepeat"],
    message: "The new passwords do not match",
  })
  .refine((data) => data.confirmation === "RESET APPLICATION", {
    path: ["confirmation"],
    message: "Type RESET APPLICATION to start the operation",
  });

export async function requestSystemResetAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = resetFormSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    bootstrapFullName: formData.get("bootstrapFullName"),
    bootstrapEmail: formData.get("bootstrapEmail"),
    bootstrapPassword: formData.get("bootstrapPassword"),
    bootstrapPasswordRepeat: formData.get("bootstrapPasswordRepeat"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return {
      error:
        issue === "Current password is required"
          ? t("screens.settingsForms.reset.currentPasswordRequired")
          : issue === "The new passwords do not match"
            ? t("screens.settingsForms.reset.passwordsDoNotMatch")
            : issue === "Type RESET APPLICATION to start the operation"
              ? t("screens.settingsForms.reset.confirmationRequired")
              : localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  const result = await requestSystemReset(prisma, {
    actorId: me.id,
    currentPassword: parsed.data.currentPassword,
    bootstrapFullName: parsed.data.bootstrapFullName,
    bootstrapEmail: parsed.data.bootstrapEmail,
    bootstrapPassword: parsed.data.bootstrapPassword,
  });

  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "reset", result),
      success: null,
    };
  }

  revalidatePath("/admin/settings/reset");
  return {
    error: null,
    success: t("screens.settingsForms.reset.requestQueued"),
  };
}
