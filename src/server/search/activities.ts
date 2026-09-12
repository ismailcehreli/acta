import { Prisma } from "@prisma/client";

import { periodStart } from "@/server/activities/scope-feed";
import {
  queryVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";





//


//




const DOCUMENT = Prisma.raw(`to_tsvector('turkish', a."title" || ' ' || a."description")`);


export const SEARCH_PAGE_SIZE = 25;


export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

const HEADLINE_OPTIONS = [
  "MaxWords=30",
  "MinWords=10",
  "ShortWord=3",
  "MaxFragments=1",
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
].join(", ");

/** Split a snippet into marked and unmarked parts for the display component. */
export function splitHighlights(
  snippet: string,
): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  let remaining = snippet;

  while (remaining.length > 0) {
    const start = remaining.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      parts.push({ text: remaining, marked: false });
      break;
    }

    if (start > 0) parts.push({ text: remaining.slice(0, start), marked: false });

    const end = remaining.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      // An unmatched marker is plain text; do not discard the remainder.
      parts.push({ text: remaining.slice(start + 1), marked: false });
      break;
    }

    parts.push({ text: remaining.slice(start + 1, end), marked: true });
    remaining = remaining.slice(end + 1);
  }

  return parts.filter((part) => part.text.length > 0);
}

export type SearchDb = ActivityRepositoryDb;

export interface SearchHit {
  id: string;
  /** Human-readable sequence number (§3.1). */
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorName: string;
  /** Author's title; may be empty. */
  authorTitle: string | null;
  authorUnitName: string;
  /** When the record was saved; distinct from its activity date (Task 11.1). */
  createdAt: Date;
  /**
   * Short snippet; matching regions are wrapped with `HIGHLIGHT_START`/
   * `HIGHLIGHT_END`. It is **not HTML**: `ts_headline` can produce a `<mark>` tag,
   * but rendering that output as HTML would execute user-provided content. The
   * markers travel in the text and the screen turns them into components.
   */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Total matches in scope; the result count is always explicit. */
  total: number;
  page: number;
  pageCount: number;
}

interface RawHit {
  id: string;
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorName: string;
  authorTitle: string | null;
  authorUnitName: string;
  createdAt: Date;
  snippet: string;
}

/**
 * Filters applied to search (Task 10.9). The fields are **the same** as the scope
 * feed and come from the shared filter component.
 *
 * **Filters do not grant access:** they are applied on top of the visibility scope
 * and none can widen it.
 */
export interface SearchFilters {
  period: "today" | "week" | "all";
  authorId: string;
  authorOrgUnitId: string;
  targetOrgUnitId: string;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  period: "all",
  authorId: "",
  authorOrgUnitId: "",
  targetOrgUnitId: "",
};

/**
 * Convert filters into a SQL fragment. Values are passed **as parameters**; no
 * string concatenation is used because these values come from the address bar.
 */
function filterSql(filters: SearchFilters, now: Date): Prisma.Sql {
  const fragments: Prisma.Sql[] = [];

  const start = periodStart(filters.period, now);
  if (start) fragments.push(Prisma.sql`AND a."activityDate" >= ${start}`);

  if (filters.authorId !== "") {
    fragments.push(Prisma.sql`AND a."authorId" = ${filters.authorId}`);
  }

  if (filters.authorOrgUnitId !== "") {
    fragments.push(Prisma.sql`AND a."authorOrgUnitId" = ${filters.authorOrgUnitId}`);
  }

  if (filters.targetOrgUnitId !== "") {
    fragments.push(Prisma.sql`
      AND EXISTS (
        SELECT 1 FROM "ActivityTargetDept" t
        WHERE t."activityId" = a."id" AND t."orgUnitId" = ${filters.targetOrgUnitId}
      )
    `);
  }

  return fragments.length === 0 ? Prisma.empty : Prisma.join(fragments, " ");
}

export async function searchActivities(
  db: SearchDb,
  viewer: Viewer,
  query: string,
  page = 1,
  pageSize = SEARCH_PAGE_SIZE,
  subordinates?: string[],
  filters: SearchFilters = EMPTY_SEARCH_FILTERS,
  now: Date = new Date(),
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed === "") return { hits: [], total: 0, page: 1, pageCount: 0 };

  const filterFragment = filterSql(filters, now);
  const safePage = Math.max(1, Math.trunc(page));
  const offset = (safePage - 1) * pageSize;

  const [countRow] = await queryVisibleActivities<{ total: bigint }>(
    db,
    viewer,
    (scope) => Prisma.sql`
    SELECT count(*)::bigint AS total
    FROM "Activity" a, plainto_tsquery('turkish', ${trimmed}) q
    WHERE ${DOCUMENT} @@ q AND ${scope} ${filterFragment}
  `,
    subordinates,
    now,
  );

  const total = Number(countRow?.total ?? 0);
  if (total === 0) {
    return { hits: [], total: 0, page: safePage, pageCount: 0 };
  }

  const rows = await queryVisibleActivities<RawHit>(
    db,
    viewer,
    (scope) => Prisma.sql`
    SELECT
      a."id",
      a."activityNo",
      a."activityDate",
      a."title",
      a."approvalStatus"::text AS "approvalStatus",
      a."createdAt",
      u."fullName" AS "authorName",
      u."title" AS "authorTitle",
      o."name" AS "authorUnitName",
      ts_headline('turkish', a."description", q, ${HEADLINE_OPTIONS}) AS "snippet"
    FROM "Activity" a
    JOIN "User" u ON u."id" = a."authorId"
    JOIN "OrgUnit" o ON o."id" = a."authorOrgUnitId",
      plainto_tsquery('turkish', ${trimmed}) q
    WHERE ${DOCUMENT} @@ q AND ${scope} ${filterFragment}
    ORDER BY ts_rank(${DOCUMENT}, q) DESC, a."activityDate" DESC, a."id" DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `,
    subordinates,
    now,
  );

  return {
    hits: rows,
    total,
    page: safePage,
    pageCount: Math.ceil(total / pageSize),
  };
}
