import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildStoredName } from "./rules";

// Dosya deposu (§17.2): sunucu dosya sistemi, erişim kontrollü uç nokta
// üzerinden servis edilir. 50 kullanıcı için nesne depolama gereksizdir.
//
// Dosyalar web sunucusundan **doğrudan servis edilmez** (§15.4); bu modül
// yalnızca diske yazar ve okur, yetki kararı çağırana aittir.

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

/** Saklama adı sunucuda üretilir; kullanıcının verdiği ad kullanılmaz. */
export async function storeFile(content: Buffer): Promise<StoredFile> {
  const storedName = buildStoredName(randomBytes(24).toString("hex"));

  // İki kademeli klasör: tek dizinde binlerce dosya birikmesin.
  const shard = storedName.slice(0, 2);
  const directory = path.join(STORAGE_ROOT, shard);
  const absolutePath = path.join(directory, storedName);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, content);

  return {
    storedName,
    // Yol veritabanında köke göreli tutulur: depo taşınırsa kayıtlar bozulmaz.
    storagePath: path.join(shard, storedName),
    sha256: sha256Of(content),
    sizeBytes: content.byteLength,
  };
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  // Yol, veritabanındaki kayıttan gelir ve sunucu tarafından üretilmiştir;
  // yine de kök dışına çıkılmadığı doğrulanır.
  const absolutePath = path.resolve(STORAGE_ROOT, storagePath);

  if (!absolutePath.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Geçersiz dosya yolu.");
  }

  return readFile(absolutePath);
}

/**
 * Depodaki dosyayı siler.
 *
 * **Yalnız açıkça izin verilen temizlik yollarında** kullanılır (§22.3):
 * taslak kullanıcı tarafından silindiğinde veya başarısız bir transaction'ın
 * geride bıraktığı yeni dosyalar temizlenir. Gerçek bir faaliyet ekinin dosyası
 * silinmez: faaliyet iptal edilse bile dosya durur, erişim yetkisi faaliyetin
 * durumunu izler (§15.4).
 *
 * Dosya zaten yoksa hata verilmez: temizlik yarıda kalmış olabilir ve ikinci
 * çalıştırmanın bunu takılmadan tamamlaması gerekir.
 */
export async function deleteStoredFile(storagePath: string): Promise<void> {
  const absolutePath = path.resolve(STORAGE_ROOT, storagePath);

  if (!absolutePath.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Geçersiz dosya yolu.");
  }

  await rm(absolutePath, { force: true });
}
