"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSystemAdmin } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { requestSystemReset } from "@/server/reset/service";
import { emailSchema, passwordSchema } from "@/shared/schemas/auth";
import { fullNameSchema } from "@/shared/schemas/user";

import type { ResetFormState } from "./form-state";

const resetFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut parola gerekli").max(200),
    bootstrapFullName: fullNameSchema,
    bootstrapEmail: emailSchema,
    bootstrapPassword: passwordSchema,
    bootstrapPasswordRepeat: z.string(),
    confirmation: z.string().trim(),
  })
  .refine((data) => data.bootstrapPassword === data.bootstrapPasswordRepeat, {
    path: ["bootstrapPasswordRepeat"],
    message: "Yeni parolalar eşleşmiyor",
  })
  .refine((data) => data.confirmation === "BAŞLANGICA DÖN", {
    path: ["confirmation"],
    message: "İşlemi başlatmak için BAŞLANGICA DÖN yazın",
  });

export async function requestSystemResetAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const me = await requireSystemAdmin();

  const parsed = resetFormSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    bootstrapFullName: formData.get("bootstrapFullName"),
    bootstrapEmail: formData.get("bootstrapEmail"),
    bootstrapPassword: formData.get("bootstrapPassword"),
    bootstrapPasswordRepeat: formData.get("bootstrapPasswordRepeat"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz.",
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

  if (!result.ok) return { error: result.message, success: null };

  revalidatePath("/admin/settings/reset");
  return {
    error: null,
    success:
      "İstek sıraya alındı. Önce yedek alınacak; işlem başladığında mevcut oturumlar kapatılacak.",
  };
}
