import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";

import { initials } from "@/shared/format/avatar-initials";
import type { PrismaClient } from "@prisma/client";


//





//


//



export type AvatarDb = Pick<PrismaClient, "user">;


function storageRoot(): string {
  return (
    process.env.AVATAR_STORAGE_DIR ??
    path.join(process.cwd(), "storage", "avatars")
  );
}


export const AVATAR_MAX_BYTES = 512 * 1024;


const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export type AvatarRefusal = "empty" | "too_large" | "unsupported_type";

export const AVATAR_MESSAGES: Record<AvatarRefusal, string> = {
  empty: "An empty file cannot be uploaded.",
  too_large: "The profile picture can be at most 512 KB.",
  unsupported_type: "Only PNG, JPEG, and WebP files can be uploaded. SVG is not accepted.",
};

export type AvatarResult =
  | { ok: true; extension: string }
  | { ok: false; reason: AvatarRefusal; message: string };


function filePath(userId: string, extension: string): string | null {


  const name = `${userId}.${extension}`;
  const resolvedPath = path.resolve(storageRoot(), name);

  return resolvedPath.startsWith(path.resolve(storageRoot()) + path.sep)
    ? resolvedPath
    : null;
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

  const targetPath = filePath(userId, extension);
  if (!targetPath) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: AVATAR_MESSAGES.unsupported_type,
    };
  }

  // Remove a previous file with a different type so changing the extension
  // does not leave duplicate files in storage.
  const previous = await db.user.findUnique({
    where: { id: userId },
    select: { avatarExtension: true },
  });

  await mkdir(storageRoot(), { recursive: true });
  await writeFile(targetPath, content);

  if (previous?.avatarExtension && previous.avatarExtension !== extension) {
    const old = filePath(userId, previous.avatarExtension);
    if (old) await rm(old, { force: true });
  }

  await db.user.update({ where: { id: userId }, data: { avatarExtension: extension } });

  return { ok: true, extension };
}

/** Removes the picture file and clears the database field. */
export async function removeAvatar(db: AvatarDb, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { avatarExtension: true },
  });
  if (!user?.avatarExtension) return;

  const targetPath = filePath(userId, user.avatarExtension);
  if (targetPath) await rm(targetPath, { force: true });

  await db.user.update({ where: { id: userId }, data: { avatarExtension: null } });
}

/** Reads the file; returns `null` when it is missing or escapes the storage root. */
export async function readAvatar(
  userId: string,
  extension: string,
): Promise<Buffer | null> {
  const targetPath = filePath(userId, extension);
  if (!targetPath) return null;

  try {
    return await readFile(targetPath);
  } catch {
    return null;
  }
}

export { initials };
