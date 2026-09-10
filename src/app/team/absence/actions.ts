"use server";

import { revalidatePath } from "next/cache";

import {
  markNoActivityPeriod,
  cancelNoActivityPeriod,
  decideNoActivityPeriod,
} from "@/server/absence/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  absenceDecisionSchema,
  cancelAbsenceSchema,
  markAbsenceSchema,
} from "@/shared/schemas/absence";

import type { AbsenceFormState } from "./form-state";

// Yetki kontrolü servisin içindedir (ast listesi görünürlük modülünden gelir);
// burada yalnız oturum aranır. Ekranın gizlenmesi güvenlik değildir.

function hata(message: string): AbsenceFormState {
  return { error: message, success: null };
}

export async function markAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  if (!me) return hata("Oturum bulunamadı.");

  const rawDeputy = formData.get("deputyId");
  const rawNote = formData.get("note");

  const parsed = markAbsenceSchema.safeParse({
    userId: formData.get("userId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    note: typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote : undefined,
    deputyId:
      typeof rawDeputy === "string" && rawDeputy !== "" ? rawDeputy : undefined,
  });

  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Girdi geçersiz");
  }

  const sonuc = await markNoActivityPeriod(prisma, me.id, parsed.data, new Date());
  if (!sonuc.ok) return hata(sonuc.message);

  revalidatePath("/team/absence");
  return {
    error: null,
    success:
      "Kaydedildi. Bu tarihlerde kişiye hatırlatma gitmez ve kişi katılım hesabında beklenen gün sayılmaz.",
  };
}

export async function decideAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  if (!me) return hata("Oturum bulunamadı.");

  const rawReason = formData.get("reason");
  const parsed = absenceDecisionSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    reason:
      typeof rawReason === "string" && rawReason.trim() !== ""
        ? rawReason
        : undefined,
  });
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "Karar bilgisi geçersiz.");
  }

  const sonuc = await decideNoActivityPeriod(
    prisma,
    me.id,
    parsed.data.id,
    parsed.data.decision,
    parsed.data.reason,
    new Date(),
  );
  if (!sonuc.ok) return hata(sonuc.message);

  revalidatePath("/team/absence");
  revalidatePath("/absence");
  revalidatePath("/");

  return {
    error: null,
    success:
      parsed.data.decision === "APPROVED"
        ? "Talep onaylandı. Bu günler artık hatırlatma ve katılım hesabında dikkate alınmayacak."
        : "Talep reddedildi.",
  };
}

export async function cancelAbsenceAction(
  _previous: AbsenceFormState,
  formData: FormData,
): Promise<AbsenceFormState> {
  const me = await getCurrentUser();
  if (!me) return hata("Oturum bulunamadı.");

  const parsed = cancelAbsenceSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return hata(parsed.error.issues[0]?.message ?? "İşaret bilgisi geçersiz.");
  }

  const sonuc = await cancelNoActivityPeriod(
    prisma,
    me.id,
    parsed.data.id,
    parsed.data.reason,
  );
  if (!sonuc.ok) return hata(sonuc.message);

  revalidatePath("/team/absence");
  revalidatePath("/deputy");
  return { error: null, success: "Kayıt iptal edildi." };
}
