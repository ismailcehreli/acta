import { DEFAULT_LOCALE, LOCALE_LANGUAGE_TAGS } from "@/shared/i18n";

// Extract initials without depending on the server or the rendering layer.

/**
 * Returns the initials used when a profile image is unavailable.
 */
export function initials(
  fullName: string,
  locale = LOCALE_LANGUAGE_TAGS[DEFAULT_LOCALE],
): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";

  const first = parts[0] as string;
  const last = parts.length > 1 ? (parts.at(-1) as string) : "";

  return `${first[0] ?? ""}${last[0] ?? ""}`.toLocaleUpperCase(locale);
}
