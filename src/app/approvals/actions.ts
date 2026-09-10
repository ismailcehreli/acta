"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { approveMany } from "@/server/activities/approval-groups";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import type { BulkApprovalFormState } from "./form-state";

// Toplu onay eylemi (Görev 10.6).
//
// Yetki servis katmanında: her kayıt tek tek `approveActivity`'den geçiyor ve
// o da yalnız aktif onaylayıcıya izin veriyor. Buradaki iş oturumu okuyup
// girdiyi doğrulamak.

const bulkSchema = z.object({
  // Bir gün + bir kişi grubu; üst sınır kazara devasa bir gönderimi keser.
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function approveManyAction(
  _previous: BulkApprovalFormState,
  formData: FormData,
): Promise<BulkApprovalFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Oturum bulunamadı.", success: null };

  const parsed = bulkSchema.safeParse({
    ids: formData.getAll("activityIds").map(String),
  });

  if (!parsed.success) {
    return { error: "Onaylanacak kayıt seçilmedi.", success: null };
  }

  const sonuc = await approveMany(prisma, user.id, parsed.data.ids, new Date());

  revalidatePath("/approvals");
  revalidatePath("/");

  if (sonuc.approved === 0) {
    return {
      error:
        sonuc.skipped[0]?.message ??
        "Kayıtlar onaylanamadı. Sayfayı yenileyip tekrar deneyin.",
      success: null,
    };
  }

  if (sonuc.skipped.length > 0) {
    // Sessiz kısmi başarı yok: kaçının geçmediği söylenir. Grup ekranda
    // kaldığı için mesaj kartın içinde gösterilebilir.
    return {
      error: `${sonuc.skipped.length} kayıt bu sırada değişti ve onaylanamadı. ${sonuc.approved} kayıt onaylandı.`,
      success: null,
    };
  }

  // **Başarı mesajı sayfa düzeyinde.** Grup onaylandıktan sonra ekrandan
  // kalkıyor; mesajı kartın içinde döndürmek onu kartla birlikte yok
  // ediyordu — kullanıcı her şeyin kaybolduğunu görüyor ama onaylandığını
  // görmüyordu. Aynı kalıp faaliyet kaydında da kullanılıyor.
  redirect(`/approvals?onaylandi=${sonuc.approved}`);
}
