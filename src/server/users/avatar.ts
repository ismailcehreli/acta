import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";

import { initials } from "@/shared/format/avatar-initials";
import type { PrismaClient } from "@prisma/client";

// Profil resmi (Görev 11.5).
//
// Dosya diskte durur, veritabanında değil — marka logosuyla aynı gerekçe:
// küçük de olsa ikili veriyi her sayfa yüklemesinde satırla taşımak gereksiz.
// Veritabanında yalnız uzantı durur; dosya adı kullanıcının **kimliği**dir,
// dolayısıyla kullanıcının verdiği ad hiçbir zaman dosya sistemine geçmez
// (§15.4 ile aynı ilke).
//
// **Tür içerik imzasından doğrulanır**, uzantıdan değil: uzantısı `.png` olan
// bir çalıştırılabilir buradan geçemez.
//
// **SVG kabul edilmez.** Marka logosunda kabul ediliyor çünkü onu tek bir
// sistem yöneticisi yüklüyor; avatarı herkes yüklüyor ve SVG betik taşıyabilir.

export type AvatarDb = Pick<PrismaClient, "user">;

/** Depo kökü her çağrıda okunur: testler geçici bir klasöre yönlendirir. */
function depoKoku(): string {
  return (
    process.env.AVATAR_STORAGE_DIR ??
    path.join(process.cwd(), "storage", "avatars")
  );
}

/**
 * Boyut sınırı.
 *
 * Resim **tarayıcıda** küçültülüp gönderiliyor (256×256, WebP/JPEG); tipik
 * dosya 20–40 KB. Buradaki sınır normal yolu değil, kötüye kullanımı
 * kesiyor: sunucuda küçültme yapmak yeni bir yerel bağımlılık (sharp)
 * gerektirirdi ve bu ayrı bir karardır.
 */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** Kabul edilen türler ve diske yazılacak uzantıları. */
const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export type AvatarRefusal = "empty" | "too_large" | "unsupported_type";

export const AVATAR_MESSAGES: Record<AvatarRefusal, string> = {
  empty: "Boş dosya yüklenemez.",
  too_large: "Profil resmi en fazla 512 KB olabilir.",
  unsupported_type:
    "Yalnız PNG, JPEG ve WebP yüklenebilir. SVG kabul edilmiyor.",
};

export type AvatarResult =
  | { ok: true; extension: string }
  | { ok: false; reason: AvatarRefusal; message: string };

/** Dosya yolu; kimlik dışında hiçbir şey ada karışmaz. */
function dosyaYolu(userId: string, extension: string): string | null {
  // Kimlik veritabanından gelen bir UUID; yine de kök dışına çıkılmadığı
  // doğrulanır — yol üretimi tek yerde ve savunmalı olsun.
  const ad = `${userId}.${extension}`;
  const tam = path.resolve(depoKoku(), ad);

  return tam.startsWith(path.resolve(depoKoku()) + path.sep) ? tam : null;
}

export async function saveAvatar(
  db: AvatarDb,
  userId: string,
  content: Buffer,
): Promise<AvatarResult> {
  if (content.byteLength === 0) {
    return { ok: false, reason: "empty", message: AVATAR_MESSAGES.empty };
  }
  if (content.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, reason: "too_large", message: AVATAR_MESSAGES.too_large };
  }

  const detected = await fileTypeFromBuffer(content);
  const extension = detected ? ALLOWED.get(detected.mime) : undefined;
  if (!extension) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: AVATAR_MESSAGES.unsupported_type,
    };
  }

  const hedef = dosyaYolu(userId, extension);
  if (!hedef) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: AVATAR_MESSAGES.unsupported_type,
    };
  }

  // Önceki resim başka bir türdeyse dosyası artık kalıyordu; uzantı
  // değiştiğinde eskisi silinmeli, depoda iki dosya birikmemeli.
  const onceki = await db.user.findUnique({
    where: { id: userId },
    select: { avatarExtension: true },
  });

  await mkdir(depoKoku(), { recursive: true });
  await writeFile(hedef, content);

  if (onceki?.avatarExtension && onceki.avatarExtension !== extension) {
    const eski = dosyaYolu(userId, onceki.avatarExtension);
    if (eski) await rm(eski, { force: true });
  }

  await db.user.update({ where: { id: userId }, data: { avatarExtension: extension } });

  return { ok: true, extension };
}

/** Resmi kaldırır: hem dosya hem alan temizlenir. */
export async function removeAvatar(db: AvatarDb, userId: string): Promise<void> {
  const kullanici = await db.user.findUnique({
    where: { id: userId },
    select: { avatarExtension: true },
  });
  if (!kullanici?.avatarExtension) return;

  const yol = dosyaYolu(userId, kullanici.avatarExtension);
  if (yol) await rm(yol, { force: true });

  await db.user.update({ where: { id: userId }, data: { avatarExtension: null } });
}

/** Dosyayı okur; yoksa ya da yol kök dışına çıkıyorsa `null`. */
export async function readAvatar(
  userId: string,
  extension: string,
): Promise<Buffer | null> {
  const yol = dosyaYolu(userId, extension);
  if (!yol) return null;

  try {
    return await readFile(yol);
  } catch {
    return null;
  }
}

export { initials };
