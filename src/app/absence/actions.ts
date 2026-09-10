"use server";

import { revalidatePath } from "next/cache";

import {
  cancelNoActivityPeriod,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import type { AbsenceFormState } from "./form-state";

// Kişinin kendi "faaliyet beklenmiyor" dönemi (Görev 11.8).
//
// Kimin adına kayıt açıldığı **oturumdan** gelir; formdan değil. Başkasının
// adına dönem açan bir istek burada hiç kurulamaz.

export async function markOwnAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı.", success: null };

  const rawDeputy = formData.get("deputyId");

  const sonuc = await markOwnNoActivityPeriod(
    prisma,
    user.id,
    {
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      note: String(formData.get("note") ?? "") || null,
      deputyId:
        typeof rawDeputy === "string" && rawDeputy !== "" ? rawDeputy : undefined,
    },
    new Date(),
  );

  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/absence");
  return {
    error: null,
    success:
      sonuc.status === "PENDING"
        ? "Talebiniz gönderildi. Yöneticiniz onaylayana kadar bu günler geçerli sayılmaz."
        : "Kaydedildi. Bu günlerde hatırlatma gitmeyecek ve katılım hesabında beklenen gün sayılmayacaksınız.",
  };
}

export async function cancelOwnAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı.", success: null };

  const sonuc = await cancelNoActivityPeriod(
    prisma,
    user.id,
    String(formData.get("id") ?? ""),
    String(formData.get("reason") ?? ""),
    new Date(),
  );

  if (!sonuc.ok) return { error: sonuc.message, success: null };

  revalidatePath("/absence");
  return { error: null, success: "Kayıt iptal edildi." };
}
