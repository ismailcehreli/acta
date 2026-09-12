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







export type AttachmentDb = Pick<
  PrismaClient,
  "attachment" | "systemSetting" | "$transaction" | "$executeRaw"
> & ActivityRepositoryDb & VisibilityDb;

export type AttachmentError =
  | AttachmentRefusal

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
  activity_not_found: "Activity not found.",

  not_author: "Activity not found.",
  attachment_not_found: "Attachment not found.",
  not_visible: "Attachment not found.",


  integrity_failed:
    "The file could not be validated or downloaded. Report this to IT support.",
};

function fail(error: AttachmentError): { ok: false; error: AttachmentError; message: string } {
  return { ok: false, error, message: MESSAGES[error] };
}


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


export interface ValidatedAttachmentFile {
  originalName: string;
  mimeType: string;
  content: Buffer;
  sha256: string;
  sizeBytes: number;
}


export interface StoredAttachmentFile extends ValidatedAttachmentFile {
  storedName: string;
  storagePath: string;
}

export type AttachmentValidationResult =
  | { ok: true; value: ValidatedAttachmentFile[] }
  | { ok: false; error: AttachmentRefusal; message: string };


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


export async function cleanupStoredFiles(files: StoredFile[]): Promise<void> {
  for (const file of files) {
    try {
      await deleteStoredFile(file.storagePath);
    } catch (error) {


      console.error(
        "[attachment] temporary file could not be cleaned up",
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



  const activity = await findActivityForAuthor(db, uploaderId, {
    where: { id: activityId },
    select: { id: true },
  });

  if (!activity) return fail("activity_not_found");

  const validated = await validateIncomingFiles(db, files);
  if (!validated.ok) return fail(validated.error);




  let stored: StoredAttachmentFile[] = [];

  try {
    const created = await db.$transaction(async (tx) => {




      await lockActivityForMaintenance(tx, activityId);

      const existingCount = await attachmentMaintenanceReader(tx).count({ where: { activityId } });
      const limits = await loadLimits(tx);
      const countProblem = checkAttachmentCount(existingCount, validated.value.length, limits);
      if (countProblem) throw new AttachmentLimitError(countProblem);

      stored = await storeValidatedFiles(validated.value);
      const rows: Attachment[] = [];

      for (const file of stored) {
        rows.push(
          await tx.attachment.create({
            data: activityAttachmentData(activityId, uploaderId, file, now),
          }),
        );
      }

      return rows;
    });

    return { ok: true, value: created };
  } catch (error) {
    if (stored.length > 0) await cleanupStoredFiles(stored);

    if (error instanceof AttachmentLimitError) return fail(error.refusal);


    // This maps the database guard even if the application check is bypassed.
    if (hasDatabaseSentinel(error, "ATTACHMENT_LIMIT_EXCEEDED")) {
      return fail("too_many");
    }

    throw error;
  }
}


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


export async function loadAttachmentForDownload(
  db: AttachmentDb,
  viewer: { id: string; isSystemAdmin: boolean },
  attachmentId: string,
): Promise<AttachmentResult<DownloadableAttachment>> {
  const attachment = await findVisibleAttachment(db, viewer, attachmentId);

  if (!attachment) return fail("attachment_not_found");

  const content = await readStoredFile(attachment.storagePath);





  //


  if (
    content.byteLength !== attachment.sizeBytes ||
    sha256Of(content) !== attachment.sha256
  ) {
    console.error(
      "[attachment] integrity validation failed",
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
