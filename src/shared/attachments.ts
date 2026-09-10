// Ek dosya türleri — **istemci ve sunucunun ortak bilgisi** (§5.2, §15.4).
//
// Hangi türün yüklenebildiği ve hangisinin tarayıcıda gösterilebildiği iki
// yerde birden lazım: sunucu yüklemeyi ve sunum biçimini buna göre reddeder,
// arayüz de kullanıcıya neyi kabul ettiğini söyler ve önizlemeyi buna göre
// çizer. Kural sunucu modülünde kalsaydı arayüz aynı listeyi ikinci kez
// yazardı ve ikisi zamanla ayrışırdı.
//
// **Video eklendi (ürün sahibi kararı, 03.09.2026).** Tasarım §5.2 türleri
// sayıyor ve videoyu saymıyordu; tasarım belgesinin güncellenmesi ürün
// sahibindedir.

/** Tasarımın saydığı türler (§5.2). */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  // Word / Excel — hem eski hem yeni biçim.
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Video — telefonla çekilen kayıtlar dâhil (mov, Apple cihazların
  // varsayılanı). SVG'nin listede olmaması bilinçlidir: içinde betik çalışır.
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/**
 * Sayfada gösterilebilen türler (§15.4).
 *
 * Ek ucu dosyayı varsayılan olarak **indirme** olarak sunar; sebebi yüklenen
 * bir dosyanın tarayıcıda çalıştırılmamasıdır. Bu gerekçe resim, PDF ve video
 * için geçerli değil: tarayıcı bunları çizer, çalıştırmaz.
 *
 * Küme bilerek **izin listesinin alt kümesi**: gösterim kapısı yükleme
 * kapısından geniş olamaz. Bir tür izin listesinden çıkarsa gösterimden de
 * kendiliğinden düşer (`isInlineViewable` iki kümeyi birlikte sorar).
 */
const INLINE_VIEWABLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/** Tür sayfada gösterilebilir mi (§15.4)? */
export function isInlineViewable(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType) && INLINE_VIEWABLE_MIME_TYPES.has(mimeType);
}

/** Gösterim biçimini seçen tek yer; arayüz de bunu kullanır. */
export type AttachmentPreviewKind = "image" | "pdf" | "video" | "none";

export function attachmentPreviewKind(mimeType: string): AttachmentPreviewKind {
  if (!isInlineViewable(mimeType)) return "none";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "pdf";
}

/** Kullanıcıya gösterilen tür listesi; yükleme formunda ve hata mesajında. */
export const ALLOWED_TYPES_LABEL = "Resim, PDF, Word, Excel ve video";
