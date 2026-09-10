import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  type Locale,
} from "@/shared/i18n/config";

/**
 * Resolves the active locale on the server side:
 * 1. Explicit user preference stored in `NEXT_LOCALE` cookie.
 * 2. `Accept-Language` header from client browser.
 * 3. Fallback to `DEFAULT_LOCALE` ('en').
 */
export async function getLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

    if (cookieLocale && isSupportedLocale(cookieLocale)) {
      return cookieLocale;
    }
  } catch {
    // In build time or environments without request context, proceed to headers/default
  }

  try {
    const headerStore = await headers();
    const acceptLang = headerStore.get("accept-language");

    if (acceptLang) {
      const preferred = acceptLang
        .split(",")
        .map((part) => part.split(";")[0].trim().toLowerCase().slice(0, 2))
        .find(isSupportedLocale);

      if (preferred) return preferred;
    }
  } catch {
    // Fallback if headers context is unavailable
  }

  return DEFAULT_LOCALE;
}
