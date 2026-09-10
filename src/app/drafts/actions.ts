"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  deleteDraft,
  hasDraftContent,
  saveDraft,
} from "@/server/activities/drafts";
import { saveDraftAttachments } from "@/server/activities/draft-attachments";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { draftIdSchema, saveDraftSchema } from "@/shared/schemas/draft";

import type { DraftActionState } from "./form-state";

// Taslak eylemleri (21.08.2026).
//
// Taslak **kimseye gönderilmez, kimseye görünmez.** Bu yüzden burada
// görünürlük denetimi yok; onun yerine her işlemde "bu taslak bu kullanıcının
// mı" sorusu var ve cevabı sorgunun `where` koşulunda duruyor.

/**
 * Formdan taslak kaydeder.
 *
 * Hem "Taslak olarak kaydet" düğmesi hem otomatik kaydetme aynı yolu kullanır;
 * fark tek bir bayrakta (`savedManually`). İki ayrı yol yazmak, birinin
 * diğerinden sessizce ayrışması demekti.
 */
export async function saveDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const ham = String(formData.get("draftId") ?? "");
  const parsed = saveDraftSchema.safeParse({
    id: ham === "" ? undefined : ham,
    activityDate: formData.get("activityDate"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    targetDepartmentIds: formData.getAll("targetDepartmentIds"),
    openFollowUp: formData.get("openFollowUp") === "on",
    savedManually: formData.get("savedManually") === "1",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz", success: null };
  }

  // Bomboş bir form taslak olarak saklanmaz: liste çöple dolar ve kullanıcı
  // kendi yazdığını bulamaz hâle gelir.
  if (!hasDraftContent(parsed.data)) {
    return {
      error: "Taslak kaydetmek için en az başlık ya da açıklama yazın.",
      success: null,
    };
  }

  const now = new Date();
  const sonuc = await saveDraft(prisma, user.id, parsed.data, now);

  if (!sonuc.ok) {
    return {
      error:
        sonuc.error === "too_many"
          ? "Taslak sayısı sınıra ulaştı. Göndermeyeceğiniz taslakları silin."
          : "Taslak bulunamadı; başkasına ait olabilir.",
      success: null,
    };
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length > 0) {
    const incoming = await Promise.all(
      files.map(async (file) => ({
        originalName: file.name,
        content: Buffer.from(await file.arrayBuffer()),
      })),
    );

    const attachments = await saveDraftAttachments(
      prisma,
      user.id,
      sonuc.draft.id,
      incoming,
      now,
    );

    if (!attachments.ok) {
      return {
        error:
          attachments.error === "draft_not_found"
            ? "Taslak bulunamadı; başkasına ait olabilir."
            : attachments.message,
        success: null,
        draftId: sonuc.draft.id,
      };
    }
  }

  revalidatePath("/drafts");

  // **Yönlendirme burada yapılmaz.** Bu eylem iki yerden çağrılıyor: düğmeden
  // (kullanıcı Taslaklar sayfasına gitmeli) ve otomatik kaydetmeden (kullanıcı
  // yazmaya devam ediyor, hiçbir yere gitmemeli). Kararı çağıran verir.
  return { error: null, success: null, draftId: sonuc.draft.id };
}

export async function deleteDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = draftIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Taslak bulunamadı.", success: null };

  const silindi = await deleteDraft(prisma, user.id, parsed.data.id);
  if (!silindi) return { error: "Taslak bulunamadı.", success: null };

  revalidatePath("/drafts");
  redirect("/drafts?kayit=silindi");
}
