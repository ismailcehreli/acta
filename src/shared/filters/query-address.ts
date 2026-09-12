// URL builder that preserves filters (Task 11.3).
//
// Every listing page needs the same behavior: pagination, page size, and filter
// links must preserve the user's **current selection**. Hand-writing each URL
// caused one value to be forgotten; the search page once preserved only the
// query, so moving to page two lost every filter.
//
// An empty value is not a selection and is omitted. This keeps shared links
// readable instead of filling the address bar with fragments such as `status=`.

/**
 * @param path      Page path (`/activities`).
 * @param current   Current selection; empty and undefined values are removed.
 * @param extra     Link-specific additions; duplicate names override current values.
 * @param drop      Parameters intentionally removed ("clear filter").
 */
export function buildQueryAddress(
  path: string,
  current: Record<string, string | undefined>,
  extra: Record<string, string> = {},
  drop: string[] = [],
): string {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries({ ...current, ...extra })) {
    if (value === undefined || value === "") continue;
    if (drop.includes(name)) continue;
    query.set(name, value);
  }

  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}
