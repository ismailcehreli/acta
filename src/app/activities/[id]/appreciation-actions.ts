"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { appreciateActivity } from "@/server/scoring/appreciation";

import type { AppreciationState } from "./appreciation-state";

// Takdir verme (Görev 11.11). Yetki ve görünürlük kararı servistedir; burası
// yalnız oturumu çözüp sonucu forma taşır.

export async function appreciateAction(
  _previous: AppreciationState,
  formData: FormData,
): Promise<AppreciationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const activityId = String(formData.get("activityId") ?? "");
  const sonuc = await appreciateActivity(prisma, user.id, activityId, new Date());

  if (!sonuc.ok) return { error: sonuc.message };

  revalidatePath(`/activities/${activityId}`);
  return { error: null };
}
