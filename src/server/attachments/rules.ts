// Dosya eki kuralları (§15.4, §5.2).
//
// İzin verilen türler tasarımda sayılıdır ve **istemciyle ortak** bir yerde
// durur (`@/shared/attachments`): yükleme formu da aynı listeyi gösteriyor.
// Tür **uzantıya değil içerik imzasına** göre doğrulanır — uzantısı .pdf olan
// bir çalıştırılabilir dosya buradan geçemez.

import { ALLOWED_MIME_TYPES, ALLOWED_TYPES_LABEL } from "@/shared/attachments";

export {
  ALLOWED_MIME_TYPES,
  ALLOWED_TYPES_LABEL,
  attachmentPreviewKind,
  isInlineViewable,
  type AttachmentPreviewKind,
} from "@/shared/attachments";

export type AttachmentRefusal =
  | "too_large"
  | "too_many"
  | "unsupported_type"
  | "empty_file";

export const ATTACHMENT_MESSAGES: Record<AttachmentRefusal, string> = {
  too_large: "Dosya boyutu sınırı aşıldı.",
  too_many: "Bir faaliyete eklenebilecek dosya sayısı sınırı aşıldı.",
  unsupported_type: `Bu dosya türü kabul edilmiyor. ${ALLOWED_TYPES_LABEL} dosyaları yüklenebilir.`,
  empty_file: "Boş dosya yüklenemez.",
};

export interface AttachmentLimits {
  maxSizeBytes: number;
  maxCount: number;
}

export function checkAttachmentSize(
  sizeBytes: number,
  limits: AttachmentLimits,
): AttachmentRefusal | null {
  if (sizeBytes <= 0) return "empty_file";
  if (sizeBytes > limits.maxSizeBytes) return "too_large";
  return null;
}

export function checkAttachmentCount(
  existingCount: number,
  incomingCount: number,
  limits: AttachmentLimits,
): AttachmentRefusal | null {
  return existingCount + incomingCount > limits.maxCount ? "too_many" : null;
}

/** İçerik imzasından bulunan tür kabul ediliyor mu (§15.4). */
export function isAllowedContentType(detectedMime: string | undefined): boolean {
  return detectedMime !== undefined && ALLOWED_MIME_TYPES.has(detectedMime);
}

/**
 * Sunucuda üretilen saklama adı. Kullanıcının verdiği ad **hiçbir zaman**
 * dosya sisteminde kullanılmaz; orijinal ad yalnızca veritabanında durur.
 * Böylece yol enjeksiyonu imkânsızlaşır (§15.4).
 */
export function buildStoredName(randomId: string): string {
  // Yalnızca onaltılık karakterler; uzantı yok, ayırıcı yok.
  const safe = randomId.replace(/[^a-f0-9]/gi, "").toLowerCase();

  if (safe.length < 16) {
    throw new Error("Saklama adı için yeterli rastgelelik yok.");
  }

  return safe;
}
