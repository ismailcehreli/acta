"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  deleteDraft,
  hasDraftContent,
  saveDraft,
} from "@/server/activities/drafts";
import { saveDraftAttachments } from "@/server/activities/draft-attachments";
import { getCurrentUser } from "@/server/auth/current-user";
import { getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import { draftIdSchema, saveDraftSchema } from "@/shared/schemas/draft";

import type { DraftActionState } from "./form-state";


export async function saveDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  const rawDraftId = String(formData.get("draftId") ?? "");
  const parsed = saveDraftSchema.safeParse({
    id: rawDraftId === "" ? undefined : rawDraftId,
    activityDate: formData.get("activityDate"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
    openFollowUp: formData.get("openFollowUp") === "on",
    savedManually: formData.get("savedManually") === "1",
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }



  if (!hasDraftContent(parsed.data)) {
    return { error: t("screens.drafts.contentRequired"), success: null };
  }

  const now = new Date();
  const result = await saveDraft(prisma, user.id, parsed.data, now);

  if (!result.ok) {
    return {
      error:
        result.error === "too_many"
          ? t("screens.drafts.limitReached")
          : t("screens.drafts.notFound"),
      success: null,
    };
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length > 0) {
    const incoming = await Promise.all(
      files.map(async (file) => ({
        originalName: file.name,
        content: Buffer.from(await file.arrayBuffer()),
      })),
    );

    const attachments = await saveDraftAttachments(
      prisma,
      user.id,
      result.draft.id,
      incoming,
      now,
    );

    if (!attachments.ok) {
      return {
        error:
          attachments.error === "draft_not_found"
            ? t("screens.drafts.notFound")
            : localizeServiceMessage(t, "draftAttachment", attachments),
        success: null,
        draftId: result.draft.id,
      };
    }
  }

  revalidatePath("/drafts");




  return { error: null, success: null, draftId: result.draft.id };
}

export async function deleteDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  const parsed = draftIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: t("screens.drafts.notFound"), success: null };

  const deleted = await deleteDraft(prisma, user.id, parsed.data.id);
  if (!deleted) return { error: t("screens.drafts.notFound"), success: null };

  revalidatePath("/drafts");
  redirect("/drafts?record=deleted");
}
