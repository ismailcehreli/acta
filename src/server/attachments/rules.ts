
//





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
  too_large: "The file size limit was exceeded.",
  too_many: "The maximum number of attachments for an activity was exceeded.",
  unsupported_type: `This file type is not supported. Uploadable types: ${ALLOWED_TYPES_LABEL}.`,
  empty_file: "An empty file cannot be uploaded.",
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

/** Is the type detected from the content signature allowed (§15.4)? */
export function isAllowedContentType(detectedMime: string | undefined): boolean {
  return detectedMime !== undefined && ALLOWED_MIME_TYPES.has(detectedMime);
}

/**
 * Builds the server-generated storage name. The user-provided name is **never**
 * used in the file system; the original name is stored only in the database.
 * This prevents path injection (§15.4).
 */
export function buildStoredName(randomId: string): string {
  // Hexadecimal characters only; no extension and no path separator.
  const safe = randomId.replace(/[^a-f0-9]/gi, "").toLowerCase();

  if (safe.length < 16) {
    throw new Error("The storage name does not contain enough randomness.");
  }

  return safe;
}
