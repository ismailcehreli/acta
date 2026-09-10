"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  confirmActivityDeletion,
  describeActivityForDeletion,
  requestActivityDeletion,
} from "@/server/activities/delete";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

// Faaliyet silme ekranının sunucu eylemleri (karar 03.09.2026).
//
// Yetki kararı **her eylemde yeniden** veriliyor: ekranın açılmış olması bir
// yetki kanıtı değildir (§8.2 ile aynı ilke — sayfa yetkisi ile eylem yetkisi
// ayrı ayrı sorulur).

export interface SilmeFormState {
  error?: string;
  success?: string;
  /** Kod gönderildiyse ekran ikinci adıma geçer. */
  kodBekleniyor?: boolean;
  activityId?: string;
}

/** Girilen değer bir bağlantı da olabilir; kimliği ondan çıkarırız. */
function kimligeCevir(girdi: string): string {
  const temiz = girdi.trim();
  const eslesme = temiz.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return eslesme ? eslesme[0] : temiz;
}

async function rootKullanici() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function faaliyetAraAction(
  _previous: SilmeFormState,
  formData: FormData,
): Promise<SilmeFormState> {
  const user = await rootKullanici();
  const activityId = kimligeCevir(String(formData.get("activityId") ?? ""));

  if (activityId === "") return { error: "Faaliyet kimliği ya da bağlantısı girin." };

  const sonuc = await describeActivityForDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
  );

  if (!sonuc.ok) return { error: sonuc.message };

  // Bulunan kayıt sayfanın adresine yazılıyor: sayfa yenilendiğinde kullanıcı
  // aynı kaydın önünde kalsın.
  redirect(`/admin/faaliyet-silme?kayit=${encodeURIComponent(sonuc.value.id)}`);
}

export async function kodGonderAction(
  _previous: SilmeFormState,
  formData: FormData,
): Promise<SilmeFormState> {
  const user = await rootKullanici();
  const activityId = String(formData.get("activityId") ?? "");

  const sonuc = await requestActivityDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
    new Date(),
  );

  if (!sonuc.ok) return { error: sonuc.message, activityId };

  revalidatePath("/admin/faaliyet-silme");
  return {
    success: `Onay kodu ${user.email} adresine gönderildi. On dakika geçerlidir.`,
    kodBekleniyor: true,
    activityId,
  };
}

export async function silAction(
  _previous: SilmeFormState,
  formData: FormData,
): Promise<SilmeFormState> {
  const user = await rootKullanici();
  const activityId = String(formData.get("activityId") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  const sonuc = await confirmActivityDeletion(
    prisma,
    { id: user.id, isRoot: user.isRoot },
    activityId,
    code,
    new Date(),
  );

  if (!sonuc.ok) {
    return { error: sonuc.message, kodBekleniyor: true, activityId };
  }

  // Silinen kayıt her yerden düştü; listeler ve sayaçlar tazelenmeli.
  revalidatePath("/admin/faaliyet-silme");
  revalidatePath("/activities");
  revalidatePath("/feed");
  revalidatePath("/");

  return {
    success: `"${sonuc.value.deletedTitle}" kalıcı olarak silindi. İşlem kaydı tutuldu.`,
  };
}
