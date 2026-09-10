"use server";

import { revalidatePath } from "next/cache";

import {
  approveActivity,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  approveActivitySchema,
  rejectActivitySchema,
  requestChangesSchema,
} from "@/shared/schemas/approval";

import { emptyActivityFormState, type ActivityFormState } from "../form-state";

// Onay kararları (§5.4). Yetki servis katmanında doğrulanır: onay yalnız
// **aktif onaylayıcıya** düşer ve o da §4.4'ün çözdüğü kişidir. Buradaki tek
// iş, oturumu okuyup girdiyi doğrulamak.

export async function approveActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = approveActivitySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Faaliyet bilgisi geçersiz." };

  const sonuc = await approveActivity(prisma, user.id, parsed.data.id, new Date());
  if (!sonuc.ok) return { error: sonuc.message };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}

export async function requestChangesAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = requestChangesSchema.safeParse({
    id: formData.get("id"),
    reasonId: formData.get("reasonId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await requestChanges(
    prisma,
    user.id,
    parsed.data.id,
    { reasonId: parsed.data.reasonId, note: parsed.data.note },
    new Date(),
  );
  if (!sonuc.ok) return { error: sonuc.message };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}

/** Reddetme (ürün sahibi kararı, 19.08.2026). Gerekçe kategorisi zorunlu. */
export async function rejectActivityAction(
  _previous: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const parsed = rejectActivitySchema.safeParse({
    id: formData.get("id"),
    reasonId: formData.get("reasonId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };
  }

  const sonuc = await rejectActivity(
    prisma,
    user.id,
    parsed.data.id,
    { reasonId: parsed.data.reasonId, note: parsed.data.note },
    new Date(),
  );
  if (!sonuc.ok) return { error: sonuc.message };

  revalidatePath(`/activities/${parsed.data.id}`);
  revalidatePath("/");
  return emptyActivityFormState;
}
