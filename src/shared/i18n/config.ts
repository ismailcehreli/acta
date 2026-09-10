export const SUPPORTED_LOCALES = ["en", "tr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
};

export function isSupportedLocale(locale: unknown): locale is Locale {
  return (
    typeof locale === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(locale)
  );
}
