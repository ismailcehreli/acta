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

function pencereOzeti(pencere: WorkWindowLike): WorkWindowSummary {
  return {
    days: formatWorkingDays(pencere.workingDays),
    hours: formatWorkHours(pencere),
    holidays: formatHolidayRule(pencere),
    source: formatWindowSource(pencere),
  };
}

function failureState(failure: OrgTreeFailure): OrgFormState {
  return { error: failure.message, success: null };
}

export async function createOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();

  const parsed = createOrgUnitSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    parentId: formData.get("parentId") || null,
    attentionGroupId: formData.get("attentionGroupId") || null,
    requiresApproval: formData.get("requiresApproval") === "on",
    autoFlowsUp: formData.get("autoFlowsUp") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz", success: null };
  }

  const result = await createOrgUnit(prisma, parsed.data, me.id);
  if (!result.ok) return failureState(result);

  revalidatePath("/admin/org");
  return { error: null, success: `"${result.value.name}" birimi eklendi.` };
}

export async function reactivateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();

  const parsed = deactivateOrgUnitSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { error: "Birim seçilmedi.", success: null };
  }

  const result = await reactivateOrgUnit(prisma, parsed.data.id, me.id);
  if (!result.ok) return failureState(result);

  revalidatePath("/admin/org");
  return { error: null, success: `"${result.value.name}" birimi aktifleştirildi.` };
}

export async function updateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  // Ekranın gizlenmesi koruma değildir; yetki burada da ayrıca doğrulanır.
  const me = await requireSystemAdmin();

  const parsed = updateOrgUnitSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    type: formData.get("type"),
    attentionGroupId: formData.get("attentionGroupId") || null,
    requiresApproval: formData.get("requiresApproval") === "on",
    autoFlowsUp: formData.get("autoFlowsUp") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz", success: null };
  }

  const result = await updateOrgUnit(prisma, parsed.data, me.id);
  if (!result.ok) return failureState(result);

  revalidatePath("/admin/org");
  return { error: null, success: `"${result.value.name}" birimi güncellendi.` };
}

export async function moveOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();

  const imza = formData.get("confirmedCalendarSignature");

  const parsed = moveOrgUnitSchema.safeParse({
    id: formData.get("id"),
    newParentId: formData.get("newParentId"),
    ...(typeof imza === "string" && imza !== ""
      ? { confirmedCalendarSignature: imza }
      : {}),
  });

  if (!parsed.success) {
    return { error: "Taşıma bilgileri geçersiz.", success: null };
  }

  const result = await moveOrgUnit(prisma, parsed.data, me.id);

  // **Yan etki görülmeden onaylanmaz** (tasarım Paket H). Taşıma o birimdeki
  // herkesin hatırlatma saatini ve skor paydasını kaydırıyor; ekran iki
  // pencereyi yan yana gösterip onay istiyor.
  if (!result.ok && result.calendarChange) {
    const degisiklik = result.calendarChange;

    return {
      error: result.message,
      success: null,
      calendarConfirm: {
        unitId: parsed.data.id,
        newParentId: parsed.data.newParentId,
        signature: degisiklik.imza,
        before: pencereOzeti(degisiklik.mevcut),
        after: pencereOzeti(degisiklik.yeni),
      },
    };
  }

  if (!result.ok) return failureState(result);

  revalidatePath("/admin/org");
  return { error: null, success: `"${result.value.name}" birimi taşındı.` };
}

export async function deactivateOrgUnitAction(
  _previous: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  const me = await requireSystemAdmin();

  const parsed = deactivateOrgUnitSchema.safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { error: "Birim bilgisi geçersiz.", success: null };
  }

  const result = await deactivateOrgUnit(prisma, parsed.data.id, me.id);
  if (!result.ok) return failureState(result);

  revalidatePath("/admin/org");
  return {
    error: null,
    success: `"${result.value.name}" birimi pasifleştirildi.`,
  };
}
