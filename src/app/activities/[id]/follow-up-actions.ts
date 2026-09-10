"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  closeFollowUp,
  openFollowUp,
  reopenFollowUp,
  transferFollowUp,
} from "@/server/follow-ups/service";
import {
  closeFollowUpSchema,
  openFollowUpSchema,
  reopenFollowUpSchema,
  transferFollowUpSchema,
} from "@/shared/schemas/follow-up";

import { emptyActivityFormState, type ActivityFormState } from "../form-state";

// Takip maddesi eylemleri (§11). Yetki servis katmanında doğrulanıyor:
// içeriği göremeyen açamaz, sahibi ve üstü olmayan kapatamaz.

function tazele(activityId: string) {
  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/");
}

export async function openFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = openFollowUpSchema.safeParse({
    activityId: formData.get("activityId"),
    nextStep: formData.get("nextStep"),
    reviewDate: formData.get("reviewDate"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await openFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    {
      activityId: parsed.data.activityId,
      nextStep: parsed.data.nextStep || null,
      reviewDate: parsed.data.reviewDate
        ? new Date(`${parsed.data.reviewDate}T00:00:00.000Z`)
        : null,
    },
  );

  if (!sonuc.ok) return { error: sonuc.message };

  tazele(parsed.data.activityId);
  return emptyActivityFormState;
}

export async function closeFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = closeFollowUpSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await closeFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.note,
  );

  if (!sonuc.ok) return { error: sonuc.message };

  tazele(sonuc.item.activityId);
  return emptyActivityFormState;
}

export async function reopenFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = reopenFollowUpSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await reopenFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.note,
  );

  if (!sonuc.ok) return { error: sonuc.message };

  tazele(sonuc.item.activityId);
  return emptyActivityFormState;
}

export async function transferFollowUpAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = transferFollowUpSchema.safeParse({
    id: formData.get("id"),
    ownerId: formData.get("ownerId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await transferFollowUp(
    prisma,
    { id: user.id, isSystemAdmin: user.isSystemAdmin },
    parsed.data.id,
    parsed.data.ownerId,
  );

  if (!sonuc.ok) return { error: sonuc.message };

  tazele(sonuc.item.activityId);
  return emptyActivityFormState;
}
