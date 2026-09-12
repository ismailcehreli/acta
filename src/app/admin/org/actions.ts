"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/server/authz/admin";
import {
  createOrgUnit,
  deactivateOrgUnit,
  moveOrgUnit,
  reactivateOrgUnit,
  updateOrgUnit,
  type OrgTreeFailure,
} from "@/server/org/tree";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";
import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import {
  createOrgUnitSchema,
  deactivateOrgUnitSchema,
  moveOrgUnitSchema,
  updateOrgUnitSchema,
} from "@/shared/schemas/org";

import {
  formatHolidayRule,
  formatWindowSource,
  formatWorkHours,
  formatWorkingDays,
  type WorkWindowLike,
} from "@/shared/format/work-window";

import type { OrgFormState, WorkWindowSummary } from "./form-state";

function workWindowSummary(window: WorkWindowLike): WorkWindowSummary {
  return {
    days: formatWorkingDays(window.workingDays),
    hours: formatWorkHours(window),
    holidays: formatHolidayRule(window),
    source: formatWindowSource(window),
  };
}

function failureState(
  t: Parameters<typeof localizeServiceMessage>[0],
  failure: OrgTreeFailure,
): OrgFormState {
  return {
    error: localizeServiceMessage(t, "organization", failure),
    success: null,
  };
}

export async function createOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = createOrgUnitSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    parentId: formData.get("parentId") || null,
    attentionGroupId: formData.get("attentionGroupId") || null,
    requiresApproval: formData.get("requiresApproval") === "on",
    autoFlowsUp: formData.get("autoFlowsUp") === "on",
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]), success: null };
  }

  const result = await createOrgUnit(prisma, parsed.data, me.id);
  if (!result.ok) return failureState(t, result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: t("screens.organization.created", { unit: result.value.name }),
  };
}

export async function reactivateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = deactivateOrgUnitSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { error: t("common.invalidInput"), success: null };
  }

  const result = await reactivateOrgUnit(prisma, parsed.data.id, me.id);
  if (!result.ok) return failureState(t, result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: t("screens.organization.reactivated", { unit: result.value.name }),
  };
}

export async function updateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = updateOrgUnitSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    type: formData.get("type"),
    attentionGroupId: formData.get("attentionGroupId") || null,
    requiresApproval: formData.get("requiresApproval") === "on",
    autoFlowsUp: formData.get("autoFlowsUp") === "on",
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]), success: null };
  }

  const result = await updateOrgUnit(prisma, parsed.data, me.id);
  if (!result.ok) return failureState(t, result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: t("screens.organization.updated", { unit: result.value.name }),
  };
}

export async function moveOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const signature = formData.get("confirmedCalendarSignature");

  const parsed = moveOrgUnitSchema.safeParse({
    id: formData.get("id"),
    newParentId: formData.get("newParentId"),
    ...(typeof signature === "string" && signature !== ""
      ? { confirmedCalendarSignature: signature }
      : {}),
  });

  if (!parsed.success) {
    return { error: t("screens.organization.invalidMove"), success: null };
  }

  const result = await moveOrgUnit(prisma, parsed.data, me.id);

  if (!result.ok && result.calendarChange) {
    const change = result.calendarChange;

    return {
      error: localizeServiceMessage(t, "organization", result),
      success: null,
      calendarConfirm: {
        unitId: parsed.data.id,
        newParentId: parsed.data.newParentId,
        signature: change.signature,
        before: workWindowSummary(change.current),
        after: workWindowSummary(change.next),
      },
    };
  }

  if (!result.ok) return failureState(t, result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: t("screens.organization.moved", { unit: result.value.name }),
  };
}

export async function deactivateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();
  const t = await getTranslations();

  const parsed = deactivateOrgUnitSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: t("screens.organization.invalidUnit"), success: null };
  }

  const result = await deactivateOrgUnit(prisma, parsed.data.id, me.id);
  if (!result.ok) return failureState(t, result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: t("screens.organization.deactivated", { unit: result.value.name }),
  };
}
