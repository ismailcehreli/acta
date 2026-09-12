import type { Prisma, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit, type AuditDb } from "@/server/audit/log";

export type HelpDb = Pick<PrismaClient, "helpArticle" | "$transaction"> & AuditDb;
export type HelpReadDb = Pick<PrismaClient, "helpArticle">;

export interface HelpArticleView {
  id: string;
  category: string;
  title: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface HelpArticleInput {
  category: string;
  title: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
}

export type HelpArticleResult =
  | { ok: true; article: HelpArticleView }
  | { ok: false; error: "not_found" | "invalid_text"; message: string };

const HTML_TAG = /<\/?[a-z][^>]*>/i;

function normalizeInput(input: HelpArticleInput): HelpArticleInput | null {
  const category = input.category.trim();
  const title = input.title.trim();
  const answer = input.answer.replace(/\r\n?/g, "\n").trim();

  if (
    category.length === 0 ||
    title.length === 0 ||
    answer.length === 0 ||
    category.length > 60 ||
    title.length > 200 ||
    answer.length > 10000 ||
    HTML_TAG.test(category) ||
    HTML_TAG.test(title) ||
    HTML_TAG.test(answer) ||
    !Number.isInteger(input.sortOrder) ||
    input.sortOrder < 0 ||
    input.sortOrder > 10000
  ) {
    return null;
  }

  return { category, title, answer, sortOrder: input.sortOrder, isPublished: input.isPublished };
}

function toView(row: {
  id: string;
  category: string;
  title: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}): HelpArticleView {
  return row;
}

export async function listHelpArticles(
  db: HelpReadDb,
  options: {
    search?: string;
    category?: string;
    includeUnpublished?: boolean;
  } = {},
): Promise<HelpArticleView[]> {
  const search = options.search?.trim();
  const where: Prisma.HelpArticleWhereInput = {
    archivedAt: null,
    ...(options.includeUnpublished ? {} : { isPublished: true }),
    ...(options.category ? { category: options.category } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { answer: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await db.helpArticle.findMany({
    where,
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
  });

  return rows.map(toView);
}

export async function listHelpCategories(
  db: HelpReadDb,
  includeUnpublished = false,
): Promise<string[]> {
  const rows = await db.helpArticle.findMany({
    where: { archivedAt: null, ...(includeUnpublished ? {} : { isPublished: true }) },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });

  return rows.map((row) => row.category);
}

export async function getHelpArticle(
  db: HelpReadDb,
  id: string,
  includeUnpublished = false,
): Promise<HelpArticleView | null> {
  const row = await db.helpArticle.findFirst({
    where: {
      id,
      archivedAt: null,
      ...(includeUnpublished ? {} : { isPublished: true }),
    },
  });

  return row ? toView(row) : null;
}

export async function createHelpArticle(
  db: HelpDb,
  actorId: string,
  input: HelpArticleInput,
  now: Date = new Date(),
): Promise<HelpArticleResult> {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid_text",
      message: "Category, title, and description must be within their limits; HTML is not allowed.",
    };
  }

  const article = await db.$transaction(async (tx) => {
    const created = await tx.helpArticle.create({
      data: {
        ...normalized,
        createdById: actorId,
        updatedById: actorId,
        createdAt: now,
      },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.helpArticle,
      objectId: created.id,
      action: AUDIT_ACTIONS.helpArticleCreated,
      detail: { category: created.category },
      now,
    });

    return created;
  });

  return { ok: true, article: toView(article) };
}

export async function updateHelpArticle(
  db: HelpDb,
  actorId: string,
  id: string,
  input: HelpArticleInput,
  now: Date = new Date(),
): Promise<HelpArticleResult> {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid_text",
      message: "Category, title, and description must be within their limits; HTML is not allowed.",
    };
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.helpArticle.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, category: true },
    });
    if (!existing) {
      return {
        ok: false as const,
        error: "not_found" as const,
        message: "Help article not found.",
      };
    }

    const updated = await tx.helpArticle.update({
      where: { id },
      data: { ...normalized, updatedById: actorId, updatedAt: now },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.helpArticle,
      objectId: updated.id,
      action: AUDIT_ACTIONS.helpArticleUpdated,
      detail: { category: updated.category },
      now,
    });

    return { ok: true as const, article: toView(updated) };
  });
}

export async function archiveHelpArticle(
  db: HelpDb,
  actorId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.helpArticle.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, category: true },
    });
    if (!existing) return { ok: false as const, message: "Help article not found." };

    await tx.helpArticle.update({
      where: { id },
      data: { archivedAt: now, isPublished: false, updatedById: actorId, updatedAt: now },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.helpArticle,
      objectId: id,
      action: AUDIT_ACTIONS.helpArticleArchived,
      detail: { category: existing.category },
      now,
    });

    return { ok: true as const };
  });
}
