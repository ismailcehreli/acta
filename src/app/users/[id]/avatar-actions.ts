"use server";

import { revalidatePath } from "next/cache";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { removeAvatar, saveAvatar } from "@/server/users/avatar";

import type { AvatarFormState } from "./form-state";

// Profil resmi yükleme ve kaldırma (Görev 11.5).
//
// **Kim değiştirebilir:** kişinin kendisi ve sistem yöneticisi (ürün sahibi
// kararı, 22.08.2026). Sistem yöneticisi yetkisi §15.1'e göre işlevseldir ve
// içerik erişimi vermez; profil resmi içerik değil, hesabın bir alanıdır —
// uygunsuz bir resim için müdahale yolu da gerekir.
//
// Başkasının resmini değiştirmek **denetim izine** yazılır: "kim, kimin
// resmini değiştirdi" sorusu sonradan sorulabilmeli. Kişinin kendi resmini
// değiştirmesi iz bırakmaz; her kullanıcının rutin işi izi doldurur ve
// gerçekten bakılması gereken satırları gömerdi.

/** İşlemi yapan bu kullanıcıyı değiştirebilir mi? */
async function yetkiliMi(hedefId: string) {
  const actor = await getCurrentUser();
  if (!actor) return null;
  if (actor.id === hedefId || actor.isSystemAdmin) return actor;
  return null;
}

export async function uploadAvatarAction(
  _previous: AvatarFormState,
  formData: FormData,
): Promise<AvatarFormState> {
  const hedefId = String(formData.get("userId") ?? "");
  const actor = await yetkiliMi(hedefId);
  if (!actor) return { error: "Bu işlem için yetkiniz yok.", success: null };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bir resim seçin.", success: null };
  }

  const sonuc = await saveAvatar(
    prisma,
    hedefId,
    Buffer.from(await file.arrayBuffer()),
  );
  if (!sonuc.ok) return { error: sonuc.message, success: null };

  if (actor.id !== hedefId) {
    await recordAudit(prisma, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: hedefId,
      action: AUDIT_ACTIONS.userUpdated,
      detail: { alan: "profil resmi", islem: "yüklendi" },
      now: new Date(),
    });
  }

  revalidatePath(`/users/${hedefId}`);
  return {
    error: null,
    success: "Profil resmi güncellendi.",
    extension: sonuc.extension,
    stamp: Date.now(),
  };
}

export async function removeAvatarAction(
  _previous: AvatarFormState,
  formData: FormData,
): Promise<AvatarFormState> {
  const hedefId = String(formData.get("userId") ?? "");
  const actor = await yetkiliMi(hedefId);
  if (!actor) return { error: "Bu işlem için yetkiniz yok.", success: null };

  await removeAvatar(prisma, hedefId);

  if (actor.id !== hedefId) {
    await recordAudit(prisma, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.user,
      objectId: hedefId,
      action: AUDIT_ACTIONS.userUpdated,
      detail: { alan: "profil resmi", islem: "kaldırıldı" },
      now: new Date(),
    });
  }

  revalidatePath(`/users/${hedefId}`);
  return {
    error: null,
    success: "Profil resmi kaldırıldı.",
    extension: null,
    stamp: Date.now(),
  };
}
