import type { PrismaClient } from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import type { SaveDraftInput } from "@/shared/schemas/draft";
import { deleteStoredFile } from "@/server/attachments/storage";

import type { DraftAttachmentView } from "./draft-attachments";


//




//


//




export type DraftDb = Pick<
  PrismaClient,
  | "activityDraft"
  | "activityDraftAttachment"
  | "$transaction"
  | "$executeRawUnsafe"
>;


export const MAX_DRAFTS_PER_USER = 50;

export interface DraftView {
  id: string;
  activityDate: Date;
  title: string;
  description: string;
  targetOrgUnitIds: string[];
  openFollowUp: boolean;
  savedManually: boolean;
  updatedAt: Date;
  attachments: DraftAttachmentView[];
}

export type SaveDraftResult =
  | { ok: true; draft: DraftView }
  | { ok: false; error: "not_found" | "too_many" };


export function hasDraftContent(input: {
  title: string;
  description: string;
}): boolean {
  return input.title.trim() !== "" || input.description.trim() !== "";
}

export async function saveDraft(
  db: DraftDb,
  authorId: string,
  input: SaveDraftInput,
  now: Date = new Date(),
): Promise<SaveDraftResult> {
  const data = {
    activityDate: toDateValue(input.activityDate),
    title: input.title,
    description: input.description,
    targetOrgUnitIds: input.targetDepartmentIds,
    openFollowUp: input.openFollowUp,
    updatedAt: now,
  };

  if (input.id) {


    const currentDraft = await db.activityDraft.findFirst({
      where: { id: input.id, authorId },
      select: { id: true, savedManually: true },
    });

    if (!currentDraft) return { ok: false, error: "not_found" };

    const current = await db.activityDraft.update({
      where: { id: currentDraft.id },
      data: {
        ...data,


        savedManually: currentDraft.savedManually || input.savedManually,
      },
    });

    return { ok: true, draft: await loadDraft(db, authorId, current.id) };
  }

  const count = await db.activityDraft.count({ where: { authorId } });
  if (count >= MAX_DRAFTS_PER_USER) return { ok: false, error: "too_many" };

  const next = await db.activityDraft.create({
    data: { ...data, authorId, savedManually: input.savedManually, createdAt: now },
  });

  return { ok: true, draft: await loadDraft(db, authorId, next.id) };
}


export interface DraftFilters {
  savedManually?: boolean;
}


function draftWhere(authorId: string, filters: DraftFilters) {
  return {
    authorId,
    ...(filters.savedManually === undefined
      ? {}
      : { savedManually: filters.savedManually }),
  };
}

export async function listDrafts(
  db: DraftDb,
  authorId: string,
  filters: DraftFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<DraftView[]> {
  const rows = await db.activityDraft.findMany({
    where: draftWhere(authorId, filters),
    orderBy: { updatedAt: "desc" },
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    include: { attachments: true },
  });

  return rows.map(show);
}

export async function countDrafts(
  db: DraftDb,
  authorId: string,
  filters: DraftFilters = {},
): Promise<number> {
  return db.activityDraft.count({ where: draftWhere(authorId, filters) });
}

export async function findDraft(
  db: DraftDb,
  authorId: string,
  id: string,
): Promise<DraftView | null> {
  const row = await db.activityDraft.findFirst({
    where: { id, authorId },
    include: { attachments: true },
  });
  return row ? show(row) : null;
}


export async function deleteDraft(
  db: DraftDb,
  authorId: string,
  id: string,
): Promise<boolean> {
  const draft = await db.activityDraft.findFirst({
    where: { id, authorId },
    select: {
      id: true,
      attachments: { select: { storagePath: true } },
    },
  });

  if (!draft) return false;

  await db.$transaction(async (tx) => {


    await tx.$executeRawUnsafe("SET LOCAL app.activity_draft_delete = 'evet'");
    await tx.activityDraftAttachment.deleteMany({ where: { draftId: id } });
    await tx.activityDraft.delete({ where: { id } });
  });



  for (const attachment of draft.attachments) {
    await deleteStoredFile(attachment.storagePath).catch((error: unknown) => {
      console.error(
        "[draft deletion] attachment could not be removed",
        JSON.stringify({ draftId: id, storagePath: attachment.storagePath, error: String(error) }),
      );
    });
  }

  return true;
}

function show(row: {
  id: string;
  activityDate: Date;
  title: string;
  description: string;
  targetOrgUnitIds: string[];
  openFollowUp: boolean;
  savedManually: boolean;
  updatedAt: Date;
  attachments?: DraftAttachmentView[];
}): DraftView {
  return {
    id: row.id,
    activityDate: row.activityDate,
    title: row.title,
    description: row.description,
    targetOrgUnitIds: row.targetOrgUnitIds,
    openFollowUp: row.openFollowUp,
    savedManually: row.savedManually,
    updatedAt: row.updatedAt,


    attachments: (row.attachments ?? []).map(
      ({ id, originalName, sizeBytes, mimeType, createdAt }) => ({
        id,
        originalName,
        sizeBytes,
        mimeType,
        createdAt,
      }),
    ),
  };
}

async function loadDraft(
  db: DraftDb,
  authorId: string,
  id: string,
): Promise<DraftView> {
  const row = await db.activityDraft.findFirst({
    where: { id, authorId },
    include: { attachments: true },
  });

  if (!row) {
    throw new Error(`Saved draft could not be read: ${id}`);
  }

  return show(row);
}
