"use server";

import { z } from "zod";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import type { NotificationModeState } from "./form-state";

// Bildirim tercihi (Görev 10.8).
//
// Tercih **yalnız kişinin kendisi** tarafından değiştirilir; kimin tercihi
// olduğu oturumdan gelir. Başkasının bildirimlerini sessizce kapatan bir uç,
// onu kendi işinden habersiz bırakırdı.

const schema = z.object({
  mode: z.enum(["INSTANT", "DAILY_DIGEST", "ACTION_ONLY"]),
});

export async function saveNotificationModeAction(
  _previous: NotificationModeState,
  formData: FormData,
): Promise<NotificationModeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı.", success: null };

  const parsed = schema.safeParse({ mode: formData.get("mode") });
  if (!parsed.success) return { error: "Geçersiz seçim.", success: null };

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { notificationMode: parsed.data.mode },
    });

    await recordAudit(tx, {
      userId: user.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: user.id,
      action: AUDIT_ACTIONS.notificationModeChanged,
      detail: { mode: parsed.data.mode },
      now,
    });
  });

  // **Tazeleme yok.** Bu tercihe bağlı başka bir şey ekranda görünmüyor;
  // `revalidatePath` sunucu ağacını yeniden çizip formun kendi durumunu
  // sıfırlıyor ve "kaydedildi" mesajı kullanıcıya hiç görünmeden kayboluyordu.
  // Değer bir sonraki gezinmede zaten veritabanından okunuyor.
  return { error: null, success: "Bildirim tercihiniz kaydedildi." };
}
