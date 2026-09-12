"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  askQuestionSchema,
  closeConversationSchema,
  replySchema,
} from "@/shared/schemas/conversation";

import type { ConversationFormState } from "./conversation-state";

async function actor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return { id: user.id, isSystemAdmin: user.isSystemAdmin };
}

export async function askQuestionAction(
  _previous: ConversationFormState,
  formData: FormData,
): Promise<ConversationFormState> {
  const me = await actor();
  const t = await getTranslations();

  const parsed = askQuestionSchema.safeParse({
    activityId: formData.get("activityId"),
    text: formData.get("text"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await askQuestion(prisma, me, parsed.data, new Date());
  if (!result.ok) {
    return { error: localizeServiceMessage(t, "conversation", result) };
  }

  revalidatePath(`/activities/${parsed.data.activityId}`);
  return { error: null };
}

export async function replyAction(
  _previous: ConversationFormState,
  formData: FormData,
): Promise<ConversationFormState> {
  const me = await actor();
  const t = await getTranslations();

  const parsed = replySchema.safeParse({
    conversationId: formData.get("conversationId"),
    text: formData.get("text"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await replyToConversation(prisma, me, parsed.data, new Date());
  if (!result.ok) {
    return { error: localizeServiceMessage(t, "conversation", result) };
  }

  revalidatePath(`/activities/${result.value.activityId}`);
  return { error: null };
}

export async function closeConversationAction(
  _previous: ConversationFormState,
  formData: FormData,
): Promise<ConversationFormState> {
  const me = await actor();
  const t = await getTranslations();

  const rawReason = formData.get("reason");
  const parsed = closeConversationSchema.safeParse({
    conversationId: formData.get("conversationId"),
    // An empty field means no reason was provided; the schema rejects empty text.
    reason: typeof rawReason === "string" && rawReason.trim() !== "" ? rawReason : undefined,
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
    };
  }

  const result = await closeConversation(
    prisma,
    me,
    parsed.data.conversationId,
    new Date(),
    parsed.data.reason,
  );
  if (!result.ok) {
    return { error: localizeServiceMessage(t, "conversation", result) };
  }

  revalidatePath(`/activities/${result.value.activityId}`);
  return { error: null };
}
