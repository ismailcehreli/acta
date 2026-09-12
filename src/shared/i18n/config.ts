import type { DeepPartial } from "./types";
import { en, type Messages } from "./messages/en";
import { tr } from "./messages/tr";

/**
 * The only registry that must change when a new locale is introduced.
 * Screens and business logic consume message keys, never locale-specific data.
 */
export const LOCALE_REGISTRY = {
  en: { label: "English", languageTag: "en-US", dictionary: en },
  tr: { label: "Türkçe", languageTag: "tr-TR", dictionary: tr },
} as const satisfies Record<
  string,
  { label: string; languageTag: string; dictionary: DeepPartial<Messages> }
>;

export type Locale = keyof typeof LOCALE_REGISTRY;
export const SUPPORTED_LOCALES = Object.freeze(
  Object.keys(LOCALE_REGISTRY) as Locale[],
);

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const LOCALE_LABELS = Object.fromEntries(
  Object.entries(LOCALE_REGISTRY).map(([locale, definition]) => [
    locale,
    definition.label,
  ]),
) as Record<Locale, string>;

export const LOCALE_DICTIONARIES = Object.fromEntries(
  Object.entries(LOCALE_REGISTRY).map(([locale, definition]) => [
    locale,
    definition.dictionary,
  ]),
) as Record<Locale, DeepPartial<Messages>>;

export const LOCALE_LANGUAGE_TAGS = Object.fromEntries(
  Object.entries(LOCALE_REGISTRY).map(([locale, definition]) => [
    locale,
    definition.languageTag,
  ]),
) as Record<Locale, string>;

export function isSupportedLocale(locale: unknown): locale is Locale {
  return (
    typeof locale === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(locale)
  );
}
