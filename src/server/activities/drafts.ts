import type { PrismaClient } from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import type { SaveDraftInput } from "@/shared/schemas/draft";
import { deleteStoredFile } from "@/server/attachments/storage";

import type { DraftAttachmentView } from "./draft-attachments";

// Faaliyet taslakları (21.08.2026).
//
// Taslak **yalnız yazarınındır**. Bu dosyadaki her sorgu `authorId` ile
// sınırlıdır ve görünürlük modülüne hiç uğramaz — çünkü uğrayacak bir şey
// yok: taslağı yazarından başkası hiçbir koşulda göremez. Yönetici de
// göremez, sistem yöneticisi de.
//
// Bu, `Activity` için geçerli olan kurallardan **daha dar** bir kural. Daha
// geniş olsaydı sorun olurdu; daha dar olması güvenli.
//
// **Kimlik doğrulaması her işlemde tekrarlanır:** `where` koşuluna hem taslak
// kimliği hem yazar kimliği konur. Yalnız kimliğe bakan bir `update`,
// başkasının taslağını değiştirmenin yolu olurdu.

export type DraftDb = Pick<
  PrismaClient,
  | "activityDraft"
  | "activityDraftAttachment"
  | "$transaction"
  | "$executeRawUnsafe"
>;

/** Bir kullanıcının tutabileceği azami taslak; veritabanı da zorlar. */
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

/** İçi tamamen boş bir taslak saklanmaz: liste çöple dolar. */
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
  const veri = {
    activityDate: toDateValue(input.activityDate),
    title: input.title,
    description: input.description,
    targetOrgUnitIds: input.targetDepartmentIds,
    openFollowUp: input.openFollowUp,
    updatedAt: now,
  };

  if (input.id) {
    // Kimlik **ve** yazar birlikte aranır: yalnız kimliğe bakan bir güncelleme
    // başkasının taslağını değiştirmenin yolu olurdu.
    const mevcut = await db.activityDraft.findFirst({
      where: { id: input.id, authorId },
      select: { id: true, savedManually: true },
    });

    if (!mevcut) return { ok: false, error: "not_found" };

    const guncel = await db.activityDraft.update({
      where: { id: mevcut.id },
      data: {
        ...veri,
        // Bilerek kaydedilmiş bir taslak, sonraki otomatik kaydetmelerle
        // "otomatik"e geri dönmez: kullanıcının kararı kalıcıdır.
        savedManually: mevcut.savedManually || input.savedManually,
      },
    });

    return { ok: true, draft: await loadDraft(db, authorId, guncel.id) };
  }

  const sayi = await db.activityDraft.count({ where: { authorId } });
  if (sayi >= MAX_DRAFTS_PER_USER) return { ok: false, error: "too_many" };

  const yeni = await db.activityDraft.create({
    data: { ...veri, authorId, savedManually: input.savedManually, createdAt: now },
  });

  return { ok: true, draft: await loadDraft(db, authorId, yeni.id) };
}

/**
 * Taslak listesinin daraltmaları (Görev 11.3).
 *
 * Tek alan var ve ayrımı taşıyor: bilerek bekletilen metin ile pencere
 * kapandığı için kazara kalan metin aynı şey değildir. Kişi "hangisini
 * bilerek bıraktım" diye sorabilmeli.
 */
export interface DraftFilters {
  savedManually?: boolean;
}

/**
 * Süzgeç koşulu. Liste ve sayaç aynı yerden besleniyor; `authorId` koşulu
 * buraya **girmez** — o her zaman ayrıca ve önce eklenir, böylece hiçbir
 * süzgeç listeyi başkasının taslaklarına açamaz.
 */
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

  return rows.map(goster);
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
  return row ? goster(row) : null;
}

/**
 * Taslağı siler.
 *
 * **Fiziksel silme.** Projedeki "silme yok" kuralı olmuş bir şeyin kaydını
 * korur; taslak hiç olmamış bir şeyin müsveddesidir. Kullanıcı gönderilmemiş
 * notunu çöpe atabilmeli ve o notun izini tutmanın kimseye faydası yok.
 *
 * Yine de yazar kontrolü var: başkasının taslağı silinemez.
 */
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
    // Taslak eki silme kapısı yalnız bu açık kullanıcı işleminin transaction'ı
    // için geçerli. Bağlantı havuzuna taşınmaz.
    await tx.$executeRawUnsafe("SET LOCAL app.activity_draft_delete = 'evet'");
    await tx.activityDraftAttachment.deleteMany({ where: { draftId: id } });
    await tx.activityDraft.delete({ where: { id } });
  });

  // Veritabanı işlemi başarıyla bittikten sonra disk dosyaları temizlenir.
  // Önce silinseydi transaction geri alındığında kayıt dosyasız kalabilirdi.
  for (const attachment of draft.attachments) {
    await deleteStoredFile(attachment.storagePath).catch((error: unknown) => {
      console.error(
        "[taslak silme] ek dosyası silinemedi",
        JSON.stringify({ draftId: id, storagePath: attachment.storagePath, error: String(error) }),
      );
    });
  }

  return true;
}

function goster(row: {
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
    // Saklama adı, fiziksel yol ve özet yalnız sunucu içi taşıma/silme için
    // gerekir; taslak sahibine bile istemciye gönderilmez.
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
    throw new Error(`Kaydedilen taslak okunamadı: ${id}`);
  }

  return goster(row);
}
