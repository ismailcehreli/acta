import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildStoredName } from "./rules";



//



const STORAGE_ROOT =
  process.env.ATTACHMENT_STORAGE_DIR ?? path.join(process.cwd(), "storage", "attachments");

export interface StoredFile {
  storedName: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
}

export function sha256Of(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}


export async function storeFile(content: Buffer): Promise<StoredFile> {
  const storedName = buildStoredName(randomBytes(24).toString("hex"));


  const shard = storedName.slice(0, 2);
  const directory = path.join(STORAGE_ROOT, shard);
  const absolutePath = path.join(directory, storedName);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, content);

  return {
    storedName,

    storagePath: path.join(shard, storedName),
    sha256: sha256Of(content),
    sizeBytes: content.byteLength,
  };
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {


  const absolutePath = path.resolve(STORAGE_ROOT, storagePath);

  if (!absolutePath.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Invalid file path.");
  }

  return readFile(absolutePath);
}


export async function deleteStoredFile(storagePath: string): Promise<void> {
  const absolutePath = path.resolve(STORAGE_ROOT, storagePath);

  if (!absolutePath.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Invalid file path.");
  }

  await rm(absolutePath, { force: true });
}
