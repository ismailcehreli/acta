// Shared part of the **"rows per page"** preference.
//
// Allowed values and validation are needed on both server and client. The
// cookie-writing client component cannot share a file with the `next/headers`
// server helper because server modules cannot enter the client bundle. The
// rule still has one source of truth: this file.

export const PAGE_SIZE_COOKIE = "page_size";

/** Selectable values. Everything outside the list is rejected. */
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Normalizes free text to an allowed value; unknown input becomes `null`. */
export function normalizePageSize(value: string | undefined | null): PageSize | null {
  if (!value) return null;

  const count = Number.parseInt(value, 10);
  return (PAGE_SIZES as readonly number[]).includes(count) ? (count as PageSize) : null;
}
