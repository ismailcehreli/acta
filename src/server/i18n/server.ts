import { createTranslator, type Locale, type TranslateFunction } from "@/shared/i18n";
import { getLocale } from "./locale";

/**
 * Returns a translation function `t` for Server Components and Server Actions.
 * If no locale is specified, it resolves the locale automatically from request cookies/headers.
 */
export async function getTranslations(
  explicitLocale?: Locale,
): Promise<TranslateFunction> {
  const locale = explicitLocale ?? (await getLocale());
  return createTranslator(locale);
}
