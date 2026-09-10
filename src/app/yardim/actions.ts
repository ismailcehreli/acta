"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveHelpArticle,
  createHelpArticle,
  updateHelpArticle,
} from "@/server/help/articles";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";
import { prisma } from "@/server/db";
import {
  helpArticleArchiveSchema,
  helpArticleSchema,
  helpArticleUpdateSchema,
} from "@/shared/schemas/help";

import type { HelpFormState } from "./form-state";

function hata(message: string): HelpFormState {
  return { error: message, success: null };
}

async function requireHelpManager() {
  const user = await getCurrentUser();
  return user && canManageHelp(user) ? user : null;
}

function articleValues(formData: FormData) {
  return {
    category: formData.get("category"),
    title: formData.get("title"),
    answer: formData.get("answer"),
    sortOrder: formData.get("sortOrder") || 0,
    isPublished: formData.get("isPublished") === "on",
  };
}

export async function createHelpArticleAction(
  _previous: HelpFormState,
  formData: FormData,
): Promise<HelpFormState> {
  const me = await requireHelpManager();
  if (!me) return hata("Bu işlem için yönetici yetkisi gerekir.");

  const parsed = helpArticleSchema.safeParse(articleValues(formData));
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Yardım yazısı geçersiz.");
  }

  const result = await createHelpArticle(prisma, me.id, parsed.data);
  if (!result.ok) return hata(result.message);

  revalidatePath("/yardim");
  redirect("/yardim");
}

export async function updateHelpArticleAction(
  _previous: HelpFormState,
  formData: FormData,
): Promise<HelpFormState> {
  const me = await requireHelpManager();
  if (!me) return hata("Bu işlem için yönetici yetkisi gerekir.");

  const parsed = helpArticleUpdateSchema.safeParse({
    id: formData.get("id"),
    ...articleValues(formData),
  });
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Yardım yazısı geçersiz.");
  }

  const result = await updateHelpArticle(prisma, me.id, parsed.data.id, parsed.data);
  if (!result.ok) return hata(result.message);

  revalidatePath("/yardim");
  revalidatePath(`/yardim/${parsed.data.id}/duzenle`);
  redirect("/yardim");
}

export async function archiveHelpArticleAction(formData: FormData): Promise<void> {
  const me = await requireHelpManager();
  if (!me) return;

  const parsed = helpArticleArchiveSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await archiveHelpArticle(prisma, me.id, parsed.data.id);
  revalidatePath("/yardim");
  redirect("/yardim");
}
