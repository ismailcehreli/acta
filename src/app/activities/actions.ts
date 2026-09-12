"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { openFollowUp } from "@/server/follow-ups/service";
import { cancelActivity } from "@/server/activities/cancel";
import { createActivity, updateActivity } from "@/server/activities/write";
import type { IncomingFile } from "@/server/attachments/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import { readActivityTextLimits } from "@/server/settings/system-settings";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  createActivitySchema,
  updateActivitySchema,
} from "@/shared/schemas/activity";
import { cancelActivitySchema } from "@/shared/schemas/cancel";
import { draftIdSchema } from "@/shared/schemas/draft";

import type { ActivityFormState } from "./form-state";


async function loadAuthor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const unit = await prisma.orgUnit.findUniqueOrThrow({
    where: { id: user.orgUnitId },
    select: { requiresApproval: true },
  });

  return {
    id: user.id,
    orgUnitId: user.orgUnitId,
    requiresApproval: unit.requiresApproval,
  };
}


async function readIncomingFiles(formData: FormData): Promise<IncomingFile[]> {
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  return Promise.all(
    files.map(async (file) => ({
      originalName: file.name,
      content: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

export async function createActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const author = await loadAuthor();
  const t = await getTranslations();

  const limits = await readActivityTextLimits(prisma);
  const parsed = createActivitySchema(limits).safeParse({
    activityDate: formData.get("activityDate"),
    title: formData.get("title"),
    description: formData.get("description"),
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const rawDraftId = String(formData.get("draftId") ?? "");
  let draftId: string | undefined;
  if (rawDraftId !== "") {
    const draft = draftIdSchema.safeParse({ id: rawDraftId });
    if (!draft.success) return { error: t("screens.drafts.notFound") };
    draftId = draft.data.id;
  }

  const now = new Date();
  const files = await readIncomingFiles(formData);
  const result = await createActivity(prisma, author, parsed.data, now, {
    draftId,
    files,
  });

  if (!result.ok) return { error: localizeServiceMessage(t, "activity", result) };




  if (formData.get("openFollowUp") === "on") {
    const followUp = await openFollowUp(
      prisma,
      { id: author.id, isSystemAdmin: false },
      { activityId: result.activity.id },
      now,
    );

    if (!followUp.ok) {
      return {
        error: t("activities.followUpOpenFailed", {
          reason: localizeServiceMessage(t, "followUp", followUp),
        }),
      };
    }
  }

  // Once submitted, the source draft is no longer needed. Keeping it would
  // show a duplicate in the drafts list and invite a second submission.
  if (draftId) {
    revalidatePath("/drafts");
  }

  revalidatePath("/activities");
  redirect("/activities?record=added");
}

export async function updateActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const author = await loadAuthor();
  const t = await getTranslations();

  const limits = await readActivityTextLimits(prisma);
  const parsed = updateActivitySchema(limits).safeParse({
    id: formData.get("id"),
    activityDate: formData.get("activityDate"),
    title: formData.get("title"),
    description: formData.get("description"),
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const files = await readIncomingFiles(formData);
  const result = await updateActivity(
    prisma,
    author.id,
    parsed.data,
    new Date(),
    { files },
  );

  if (!result.ok) return { error: localizeServiceMessage(t, "activity", result) };

  revalidatePath("/activities");
  redirect("/activities?record=revised");
}

export async function cancelActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  const t = await getTranslations();
  if (!user) redirect("/login");

  const parsed = cancelActivitySchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await cancelActivity(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.reason,
    new Date(),
  );

  if (!result.ok) {
    return { error: localizeServiceMessage(t, "cancellation", result) };
  }

  revalidatePath("/activities");
  redirect("/activities?record=cancelled");
}
