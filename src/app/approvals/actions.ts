"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { approveMany } from "@/server/activities/approval-groups";
import { getCurrentUser } from "@/server/auth/current-user";
import { getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import { localizeServiceMessage } from "@/shared/i18n/message";

import type { BulkApprovalFormState } from "./form-state";


//




const bulkSchema = z.object({

  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function approveManyAction(
  _previous: BulkApprovalFormState,
  formData: FormData,
): Promise<BulkApprovalFormState> {
  const t = await getTranslations();
  const user = await getCurrentUser();
  if (!user) return { error: t("auth.sessionNotFound"), success: null };

  const parsed = bulkSchema.safeParse({
    ids: formData.getAll("activityIds").map(String),
  });

  if (!parsed.success) {
    return { error: t("approvals.noSelection"), success: null };
  }

  const result = await approveMany(prisma, user.id, parsed.data.ids, new Date());

  revalidatePath("/approvals");
  revalidatePath("/");

  if (result.approved === 0) {
    return {
      error:
        (result.skipped[0]
          ? localizeServiceMessage(t, "approval", result.skipped[0])
          : undefined) ??
        t("approvals.bulkFailed"),
      success: null,
    };
  }

  if (result.skipped.length > 0) {
    return {
      error: t("approvals.bulkPartial", {
        skipped: result.skipped.length,
        approved: result.approved,
      }),
      success: null,
    };
  }

  // Keep the success message at page level because the approved group leaves
  // the list immediately after the action.
  redirect(`/approvals?approved=${result.approved}`);
}
