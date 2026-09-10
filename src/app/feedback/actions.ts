"use server";

import { revalidatePath } from "next/cache";

import {
  archiveFeedback,
  createFeedback,
  markFeedbackRead,
  updateFeedback,
} from "@/server/feedback/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageFeedback } from "@/server/authz/feedback";
import { prisma } from "@/server/db";
import {
  feedbackArchiveSchema,
  feedbackCreateSchema,
  feedbackReadSchema,
  feedbackUpdateSchema,
} from "@/shared/schemas/feedback";

import type { FeedbackFormState } from "./form-state";

function hata(message: string): FeedbackFormState {
  return { error: message, success: null };
}

async function requireFeedbackManager() {
  const user = await getCurrentUser();
  return user && canManageFeedback(user) ? user : null;
}

export async function createFeedbackAction(
  _previous: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  const me = await getCurrentUser();
  if (!me) return hata("Oturum bulunamadı.");

  const parsed = feedbackCreateSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    description: formData.get("description"),
    sourcePath: formData.get("sourcePath"),
    adminsOnly: false,
  });
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Geri bildirim bilgileri geçersiz.");
  }

  const result = await createFeedback(prisma, me.id, parsed.data);
  if (!result.ok) return hata(result.message);

  revalidatePath("/feedback");
  return {
    error: null,
    success: "Geri bildiriminiz kaydedildi. Durumunu bu sayfadan takip edebilirsiniz.",
  };
}

export async function markFeedbackReadAction(formData: FormData): Promise<void> {
  const me = await requireFeedbackManager();
  if (!me) return;

  const parsed = feedbackReadSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await markFeedbackRead(prisma, me.id, parsed.data.id);
  revalidatePath("/feedback");
}

export async function updateFeedbackAction(
  _previous: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  const me = await requireFeedbackManager();
  if (!me) return hata("Bu işlem için yönetici yetkisi gerekir.");

  const rawResponse = formData.get("response");
  const parsed = feedbackUpdateSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    response: typeof rawResponse === "string" ? rawResponse : undefined,
  });
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Geri bildirim bilgileri geçersiz.");
  }

  const result = await updateFeedback(
    prisma,
    me.id,
    parsed.data.id,
    parsed.data,
  );
  if (!result.ok) return hata(result.message);

  revalidatePath("/feedback");
  return { error: null, success: "Geri bildirim güncellendi." };
}

export async function archiveFeedbackAction(formData: FormData): Promise<void> {
  const me = await requireFeedbackManager();
  if (!me) return;

  const parsed = feedbackArchiveSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await archiveFeedback(prisma, me.id, parsed.data.id);
  revalidatePath("/feedback");
}
