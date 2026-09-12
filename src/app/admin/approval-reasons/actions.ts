"use server";

import { revalidatePath } from "next/cache";

import {
  createReason,
  setReasonActive,
  updateReason,
} from "@/server/approval-reasons/service";
import { requireSystemAdmin } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  createApprovalReasonSchema,
  setApprovalReasonActiveSchema,
  updateApprovalReasonSchema,
} from "@/shared/schemas/approval";

import type { ReasonFormState } from "./form-state";



export async function createReasonAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = createApprovalReasonSchema.safeParse({
    kind: formData.get("kind"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  const result = await createReason(prisma, parsed.data, me.id);
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "approvalReason", result),
      success: null,
    };
  }

  revalidatePath("/admin/approval-reasons");
  return {
    error: null,
    success: t("screens.approvalReasons.added", { reason: result.reason.label }),
  };
}

export async function updateReasonAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = updateApprovalReasonSchema.safeParse({
    id: formData.get("id"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  const result = await updateReason(prisma, parsed.data, me.id);
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "approvalReason", result),
      success: null,
    };
  }

  revalidatePath("/admin/approval-reasons");
  return {
    error: null,
    success: t("screens.approvalReasons.updated", { reason: result.reason.label }),
  };
}

export async function setReasonActiveAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = setApprovalReasonActiveSchema.safeParse({
    id: formData.get("id"),
    isActive: formData.get("isActive") === "true",
  });

  if (!parsed.success) {
    return {
      error: localizeValidationIssue(t, parsed.error.issues[0]),
      success: null,
    };
  }

  const result = await setReasonActive(
    prisma,
    parsed.data.id,
    parsed.data.isActive,
    me.id,
  );
  if (!result.ok) {
    return {
      error: localizeServiceMessage(t, "approvalReason", result),
      success: null,
    };
  }

  revalidatePath("/admin/approval-reasons");
  return {
    error: null,
    success: parsed.data.isActive
      ? t("screens.approvalReasons.reactivated", {
          reason: result.reason.label,
        })
      : t("screens.approvalReasons.deactivated", {
          reason: result.reason.label,
        }),
  };
}
