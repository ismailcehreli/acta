import type { ActivityDraftAttachment, PrismaClient } from "@prisma/client";

import {
  cleanupStoredFiles,
  readAttachmentLimits,
  storeValidatedFiles,
  validateIncomingFiles,
  type IncomingFile,
  type StoredAttachmentFile,
} from "@/server/attachments/service";
import {
  ATTACHMENT_MESSAGES,
  checkAttachmentCount,
  type AttachmentRefusal,
} from "@/server/attachments/rules";
// Taslak ekleri (§5.7, §15.4). Bu modülün bütün sorguları taslak kimliği ve
// yazar kimliğini birlikte kullanır; taslak ekleri faaliyet görünürlüğüne
// açılmaz, yalnız taslağın sahibine aittir.

export type DraftAttachmentDb = Pick<
  PrismaClient,
  | "activityDraft"
  | "activityDraftAttachment"
  | "systemSetting"
  | "$transaction"
  | "$executeRaw"
  | "$executeRawUnsafe"
>;

export interface DraftAttachmentView {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}

export type DraftAttachmentError = AttachmentRefusal | "draft_not_found";

export type DraftAttachmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DraftAttachmentError; message: string };

function fail(error: DraftAttachmentError): DraftAttachmentResult<never> {
  return {
    ok: false,
    error,
    message:
      error === "draft_not_found"
        ? "Taslak bulunamadı."
        : ATTACHMENT_MESSAGES[error],
  };
}

function fingerprint(file: { sha256: string; originalName: string }): string {
  return `${file.sha256}:${file.originalName}`;
}

/** Taslak satırını kilitler; ek sayımı kilit dışında yapılmaz. */
export async function lockDraftForMaintenance(
  db: Pick<PrismaClient, "$executeRaw">,
  draftId: string,
): Promise<void> {
  await db.$executeRaw`
    SELECT "id" FROM "ActivityDraft" WHERE "id" = ${draftId} FOR UPDATE
  `;
}

/** Bir taslağın ek listesini yalnız sahibine açar. */
export async function listDraftAttachments(
  db: Pick<PrismaClient, "activityDraftAttachment">,
  authorId: string,
  draftId: string,
): Promise<DraftAttachmentView[]> {
  const rows = await db.activityDraftAttachment.findMany({
    where: { draftId, draft: { authorId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      originalName: true,
      sizeBytes: true,
      mimeType: true,
      createdAt: true,
    },
  });

  return rows;
}

/**
 * Yeni dosyaları taslağa ekler. Aynı taslak satırı kilitlenirken aynı içerik
 * ve ad daha önce kaydedilmişse yeniden yazılmaz; otomatik kaydetme böylece
 * eki çoğaltmaz.
 */
export async function saveDraftAttachments(
  db: DraftAttachmentDb,
  authorId: string,
  draftId: string,
  files: IncomingFile[],
  now: Date,
): Promise<DraftAttachmentResult<ActivityDraftAttachment[]>> {
  if (files.length === 0) return { ok: true, value: [] };

  const validated = await validateIncomingFiles(db, files);
  if (!validated.ok) return fail(validated.error);

  let stored: StoredAttachmentFile[] = [];

  try {
    const result = await db.$transaction(async (tx) => {
      await lockDraftForMaintenance(tx, draftId);

      const draft = await tx.activityDraft.findFirst({
        where: { id: draftId, authorId },
        select: {
          id: true,
          attachments: {
            select: { sha256: true, originalName: true },
          },
        },
      });

      if (!draft) return null;

      const mevcut = new Set(draft.attachments.map(fingerprint));
      const yeni = validated.value.filter((file, index, all) => {
        const key = fingerprint(file);
        if (mevcut.has(key)) return false;
        // Aynı FormData içinde aynı dosyanın iki kez gelmesi de idempotent
        // olmalı; ilk satır yeterlidir.
        if (all.findIndex((candidate) => fingerprint(candidate) === key) !== index) {
          return false;
        }
        return true;
      });

      const limits = await readAttachmentLimits(tx);
      const countProblem = checkAttachmentCount(
        draft.attachments.length,
        yeni.length,
        limits,
      );
      if (countProblem) throw new DraftAttachmentLimitError(countProblem);
      if (yeni.length === 0) return [];

      stored = await storeValidatedFiles(yeni);

      const created: ActivityDraftAttachment[] = [];
      for (const file of stored) {
        created.push(
          await tx.activityDraftAttachment.create({
            data: {
              draftId,
              originalName: file.originalName,
              storedName: file.storedName,
              storagePath: file.storagePath,
              sizeBytes: file.sizeBytes,
              mimeType: file.mimeType,
              sha256: file.sha256,
              uploadedById: authorId,
              createdAt: now,
            },
          }),
        );
      }

      return created;
    });

    if (result === null) return fail("draft_not_found");
    return { ok: true, value: result };
  } catch (error) {
    if (stored.length > 0) await cleanupStoredFiles(stored);
    if (error instanceof DraftAttachmentLimitError) return fail(error.refusal);
    throw error;
  }
}

class DraftAttachmentLimitError extends Error {
  constructor(readonly refusal: AttachmentRefusal) {
    super(refusal);
    this.name = "DraftAttachmentLimitError";
  }
}
