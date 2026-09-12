import {
  DEFAULT_LOCALE,
  LOCALE_LANGUAGE_TAGS,
  type Locale,
} from "@/shared/i18n";

/** Compare user-facing text with the active locale's collation rules. */
export function compareLocalized(
  left: string,
  right: string,
  locale: Locale = DEFAULT_LOCALE,
): number {
  return left.localeCompare(right, LOCALE_LANGUAGE_TAGS[locale]);
}

const numberFormatterCache = new Map<Locale, Intl.NumberFormat>();

/** Format a number using the active locale's decimal and grouping rules. */
export function formatNumber(
  value: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  let formatter = numberFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE_LANGUAGE_TAGS[locale]);
    numberFormatterCache.set(locale, formatter);
  }

  return formatter.format(value);
}

/** Format a percentage whose input is expressed as a value from 0 through 100. */
export function formatPercentage(
  value: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(LOCALE_LANGUAGE_TAGS[locale], {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

/** Format an attachment size while keeping the unit abbreviations recognizable. */
export function formatFileSize(
  bytes: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`;
  if (bytes < 1024 * 1024) {
    return `${formatNumber(Math.round(bytes / 1024), locale)} KB`;
  }

  return `${formatNumber(bytes / (1024 * 1024), locale)} MB`;
}
