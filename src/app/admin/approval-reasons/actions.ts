"use server";

import { revalidatePath } from "next/cache";

import {
  createReason,
  setReasonActive,
  updateReason,
} from "@/server/approval-reasons/service";
import { requireSystemAdmin } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import {
  createApprovalReasonSchema,
  setApprovalReasonActiveSchema,
  updateApprovalReasonSchema,
} from "@/shared/schemas/approval";

import type { ReasonFormState } from "./form-state";

// Gerekçe kataloğu yönetimi (§15.1: yalnız sistem yöneticisi).

export async function createReasonAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();

  const parsed = createApprovalReasonSchema.safeParse({
    kind: formData.get("kind"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz.", success: null };
  }

  const sonuc = await createReason(prisma, parsed.data, me.id);
  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/admin/approval-reasons");
  return { error: null, success: `"${sonuc.reason.label}" eklendi.` };
}

export async function updateReasonAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();

  const parsed = updateApprovalReasonSchema.safeParse({
    id: formData.get("id"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz.", success: null };
  }

  const sonuc = await updateReason(prisma, parsed.data, me.id);
  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/admin/approval-reasons");
  return { error: null, success: `"${sonuc.reason.label}" güncellendi.` };
}

export async function setReasonActiveAction(
  _previous: ReasonFormState,
  formData: FormData,
): Promise<ReasonFormState> {
  const me = await requireSystemAdmin();

  const parsed = setApprovalReasonActiveSchema.safeParse({
    id: formData.get("id"),
    isActive: formData.get("isActive") === "true",
  });

  if (!parsed.success) return { error: "Girdi geçersiz.", success: null };

  const sonuc = await setReasonActive(
    prisma,
    parsed.data.id,
    parsed.data.isActive,
    me.id,
  );
  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/admin/approval-reasons");
  return {
    error: null,
    success: parsed.data.isActive
      ? `"${sonuc.reason.label}" yeniden kullanıma açıldı.`
      : `"${sonuc.reason.label}" pasifleştirildi.`,
  };
}
