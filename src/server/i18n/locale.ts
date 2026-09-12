import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  type Locale,
} from "@/shared/i18n/config";

/** Resolve the active locale from the explicit preference or the English default. */
export async function getLocale(): Promise<Locale> {
  try {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
    if (cookieLocale && isSupportedLocale(cookieLocale)) return cookieLocale;
  } catch {
    // Request cookies are unavailable during static generation.
  }

  return DEFAULT_LOCALE;
}
