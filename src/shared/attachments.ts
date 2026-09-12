// Attachment types — shared knowledge for the **client and server** (§5.2, §15.4).
//
// Which types can be uploaded and displayed is needed in both places: the
// server validates uploads and serving, while the UI describes accepted types
// and renders previews. Keeping the rule only in the server module would make
// the UI duplicate the list and let the two drift over time.
//
// **Video added (product decision, 03.09.2026).** Design §5.2 lists the
// supported types and now includes video; the design document is maintained by
// the product owner.

/** Types listed by the design (§5.2). */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  // Word / Excel — both legacy and current formats.
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Video — including phone recordings (mov is the Apple-device default). SVG
  // is intentionally excluded because it can contain executable scripts.
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/**
 * Types that can be displayed on the page (§15.4).
 *
 * The attachment endpoint serves files as **downloads** by default so an
 * uploaded file is not executed in the browser. This does not apply to images,
 * PDFs, and video: the browser renders them without executing them.
 *
 * This set is deliberately a **subset of the upload list**: the display gate
 * cannot be wider than the upload gate. Removing a type from the upload list
 * automatically removes it from display (`isInlineViewable` checks both sets).
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

/** Can this type be displayed on the page (§15.4)? */
export function isInlineViewable(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType) && INLINE_VIEWABLE_MIME_TYPES.has(mimeType);
}

/** Single source of truth for display mode; the UI uses it too. */
export type AttachmentPreviewKind = "image" | "pdf" | "video" | "none";

export function attachmentPreviewKind(mimeType: string): AttachmentPreviewKind {
  if (!isInlineViewable(mimeType)) return "none";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "pdf";
}

/** Type list shown to users in the upload form and error message. */
export const ALLOWED_TYPES_LABEL = "Images, PDF, Word, Excel, and video";
