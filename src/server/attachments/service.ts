import type { Attachment, PrismaClient } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";

import type { VisibilityDb } from "@/server/authz/visibility";
import {
  findActivityForAuthor,
  attachmentMaintenanceReader,
  lockActivityForMaintenance,
  findVisibleAttachment,
  listVisibleAttachments,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import { hasDatabaseSentinel } from "@/server/db-errors";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import {
  ATTACHMENT_MESSAGES,
  checkAttachmentCount,
  checkAttachmentSize,
  isAllowedContentType,
  type AttachmentLimits,
  type AttachmentRefusal,
} from "./rules";
import {
  deleteStoredFile,
  readStoredFile,
  sha256Of,
  storeFile,
  type StoredFile,
} from "./storage";

// Dosya ekleri (§15.4). Dört kural birlikte çalışır:
//   1. Saklama adı sunucuda üretilir; kullanıcının adı diske yazılmaz.
//   2. Tür uzantıdan değil içerik imzasından doğrulanır.
//   3. Dosyalar doğrudan servis edilmez; indirme görünürlükten geçer.
//   4. Her dosyanın SHA-256 özeti saklanır.

export type AttachmentDb = Pick<
  PrismaClient,
  "attachment" | "systemSetting" | "$transaction" | "$executeRaw"
> & ActivityRepositoryDb & VisibilityDb;

export type AttachmentError =
  | AttachmentRefusal
  /** Depodaki dosya kayıtla uyuşmuyor (§15.4). */
  | "integrity_failed"
  | "activity_not_found"
  | "not_author"
  | "attachment_not_found"
  | "not_visible";

export type AttachmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AttachmentError; message: string };

const MESSAGES: Record<AttachmentError, string> = {
  ...ATTACHMENT_MESSAGES,
  activity_not_found: "Faaliyet bulunamadı.",
  // Yetkisiz erişim, var olmayan kayıtla aynı cevabı alır (§18.4).
  not_author: "Faaliyet bulunamadı.",
  attachment_not_found: "Dosya bulunamadı.",
  not_visible: "Dosya bulunamadı.",
  // Kullanıcıya teknik ayrıntı verilmez ama "bulunamadı" da denmez: dosya
  // duruyor, güvenilmiyor. BT sorumlusunun bakması gereken bir durumdur.
  integrity_failed:
    "Dosya doğrulanamadı ve indirilemedi. BT sorumlusuna bildirin.",
};

function fail(error: AttachmentError): { ok: false; error: AttachmentError; message: string } {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * Yürürlükteki ek sınırları. Yükleme kararını veren yol da, kullanıcıya
 * sınırı **söyleyen** form da bunu okur: iki yerde ayrı ayrı okunsaydı
 * ekranda yazan sayı ile reddin dayandığı sayı ayrışabilirdi.
 */
export async function readAttachmentLimits(
  db: Pick<AttachmentDb, "systemSetting">,
): Promise<AttachmentLimits> {
  const [maxMb, maxCount] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.attachmentMaxMb),
    readNumericSetting(db, SETTING_KEYS.attachmentMaxCount),
  ]);

  return { maxSizeBytes: maxMb * 1024 * 1024, maxCount };
}

async function loadLimits(
  db: Pick<AttachmentDb, "systemSetting">,
): Promise<AttachmentLimits> {
  return readAttachmentLimits(db);
}

export interface IncomingFile {
  originalName: string;
  content: Buffer;
}

/** İçeriği doğrulanmış, henüz diske yazılmamış ek. */
export interface ValidatedAttachmentFile {
  originalName: string;
  mimeType: string;
  content: Buffer;
  sha256: string;
  sizeBytes: number;
}

/** Diskteki geçici/kalıcı saklama bilgisiyle birlikte doğrulanmış ek. */
export interface StoredAttachmentFile extends ValidatedAttachmentFile {
  storedName: string;
  storagePath: string;
}

export type AttachmentValidationResult =
  | { ok: true; value: ValidatedAttachmentFile[] }
  | { ok: false; error: AttachmentRefusal; message: string };

/**
 * Dosya içeriğini, boyutunu ve türünü ortak kurallardan doğrular. Disk yazımı
 * burada yapılmaz; çağıran transaction içinde sayımı ve sahiplik kontrolünü
 * yaptıktan sonra yazabilir.
 */
export async function validateIncomingFiles(
  db: Pick<AttachmentDb, "systemSetting">,
  files: IncomingFile[],
): Promise<AttachmentValidationResult> {
  if (files.length === 0) return { ok: true, value: [] };

  const limits = await readAttachmentLimits(db);
  const validated: ValidatedAttachmentFile[] = [];

  for (const file of files) {
    const sizeProblem = checkAttachmentSize(file.content.byteLength, limits);
    if (sizeProblem) {
      return { ok: false, error: sizeProblem, message: ATTACHMENT_MESSAGES[sizeProblem] };
    }

    // Tür, dosyanın kendi içeriğinden okunur. Uzantı hiç dikkate alınmaz.
    const detected = await fileTypeFromBuffer(file.content);
    if (!detected || !isAllowedContentType(detected.mime)) {
      return {
        ok: false,
        error: "unsupported_type",
        message: ATTACHMENT_MESSAGES.unsupported_type,
      };
    }

    validated.push({
      originalName: file.originalName,
      mimeType: detected.mime,
      content: file.content,
      sha256: sha256Of(file.content),
      sizeBytes: file.content.byteLength,
    });
  }

  return { ok: true, value: validated };
}

/** Doğrulanmış içerikleri diske yazar; kısmi yazımı kendi içinde temizler. */
export async function storeValidatedFiles(
  files: ValidatedAttachmentFile[],
): Promise<StoredAttachmentFile[]> {
  const stored: StoredAttachmentFile[] = [];

  try {
    for (const file of files) {
      const saved = await storeFile(file.content);
      stored.push({ ...file, ...saved });
    }
  } catch (error) {
    await cleanupStoredFiles(stored);
    throw error;
  }

  return stored;
}

/** Transaction geri alınırsa satırsız kalan dosyaları temizler. */
export async function cleanupStoredFiles(files: StoredFile[]): Promise<void> {
  for (const file of files) {
    try {
      await deleteStoredFile(file.storagePath);
    } catch (error) {
      // Asıl veritabanı hatası kaybolmasın; operasyon artığı sessizce de
      // bırakılmasın.
      console.error(
        "[ek dosyası] geçici dosya temizlenemedi",
        JSON.stringify({ storagePath: file.storagePath, error: String(error) }),
      );
    }
  }
}

export function activityAttachmentData(
  activityId: string,
  uploaderId: string,
  file: StoredAttachmentFile,
  now: Date,
) {
  return {
    activityId,
    originalName: file.originalName,
    storedName: file.storedName,
    storagePath: file.storagePath,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    sha256: file.sha256,
    uploadedById: uploaderId,
    createdAt: now,
  };
}

export async function attachFiles(
  db: AttachmentDb,
  uploaderId: string,
  activityId: string,
  files: IncomingFile[],
  now: Date,
): Promise<AttachmentResult<Attachment[]>> {
  if (files.length === 0) return { ok: true, value: [] };

  // Ek yükleme yalnızca faaliyeti yazana açıktır; sorgu baştan yazarla
  // daraltılır, böylece başkasının kaydının varlığı öğrenilemez.
  const activity = await findActivityForAuthor(db, uploaderId, {
    where: { id: activityId },
    select: { id: true },
  });

  if (!activity) return fail("activity_not_found");

  const validated = await validateIncomingFiles(db, files);
  if (!validated.ok) return fail(validated.error);

  // Dosyalar transaction içinde, faaliyet satırı kilitlenip adet kontrolü
  // yapıldıktan sonra yazılır. Transaction düşerse dışarıda satırsız kalan
  // dosyalar temizlenir; kayıtlı bir faaliyetin eki silinmez.
  let stored: StoredAttachmentFile[] = [];

  try {
    const created = await db.$transaction(async (tx) => {
      // **Sayım kilit altında yapılır** (denetim 21.08.2026, bulgu 8).
      // Kilitsiz kurguda dört eki olan faaliyete iki istek aynı anda birer
      // dosya yükleyebiliyordu: ikisi de "mevcut 4" görüyor, ikisi de kabul
      // ediliyor ve faaliyet altı eke çıkıyordu.
      await lockActivityForMaintenance(tx, activityId);

      const existingCount = await attachmentMaintenanceReader(tx).count({ where: { activityId } });
      const limits = await loadLimits(tx);
      const countProblem = checkAttachmentCount(existingCount, validated.value.length, limits);
      if (countProblem) throw new AttachmentLimitError(countProblem);

      stored = await storeValidatedFiles(validated.value);
      const satirlar: Attachment[] = [];

      for (const file of stored) {
        satirlar.push(
          await tx.attachment.create({
            data: activityAttachmentData(activityId, uploaderId, file, now),
          }),
        );
      }

      return satirlar;
    });

    return { ok: true, value: created };
  } catch (error) {
    if (stored.length > 0) await cleanupStoredFiles(stored);

    if (error instanceof AttachmentLimitError) return fail(error.refusal);

    // Veritabanı tetikleyicisi de aynı sınırı koruyor; uygulama katmanı
    // atlansa bile devreye girer.
    if (hasDatabaseSentinel(error, "ATTACHMENT_LIMIT_EXCEEDED")) {
      return fail("too_many");
    }

    throw error;
  }
}

/** Sınır ihlalini işlemden dışarı taşıyan iç hata. */
class AttachmentLimitError extends Error {
  constructor(readonly refusal: AttachmentRefusal) {
    super(refusal);
    this.name = "AttachmentLimitError";
  }
}

export interface DownloadableAttachment {
  originalName: string;
  mimeType: string;
  content: Buffer;
}

/**
 * İndirme yolu. **Faaliyeti görme yetkisi olmayan, ekini de indiremez**
 * (§15.4). Faaliyet iptal edilse bile dosya silinmez; erişim faaliyetin
 * durumunu izler (iptal edilmiş faaliyeti görebilen ekini de görebilir).
 */
export async function loadAttachmentForDownload(
  db: AttachmentDb,
  viewer: { id: string; isSystemAdmin: boolean },
  attachmentId: string,
): Promise<AttachmentResult<DownloadableAttachment>> {
  const attachment = await findVisibleAttachment(db, viewer, attachmentId);

  if (!attachment) return fail("attachment_not_found");

  const content = await readStoredFile(attachment.storagePath);

  // **Bütünlük indirme anında doğrulanır** (§15.4, denetim 21.08.2026,
  // bulgu 9). Yüklemede hesaplanan SHA-256 veritabanında duruyordu ama hiçbir
  // karar vermiyordu: depo bozulsa ya da dosya sunucu tarafında değiştirilse
  // kullanıcıya değiştirilmiş baytlar aynen veriliyordu.
  //
  // Uyuşmazlıkta dosya **verilmez**. Sessizce vermek, kurumsal hafızaya
  // güvenilmez bir belge sokmak demektir.
  if (
    content.byteLength !== attachment.sizeBytes ||
    sha256Of(content) !== attachment.sha256
  ) {
    console.error(
      "[ek dosyası] bütünlük doğrulanamadı",
      JSON.stringify({ attachmentId, storagePath: attachment.storagePath }),
    );
    return fail("integrity_failed");
  }

  return {
    ok: true,
    value: {
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      content,
    },
  };
}

export async function listActivityAttachments(
  db: AttachmentDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityId: string,
) {
  return listVisibleAttachments(db, viewer, activityId);
}
