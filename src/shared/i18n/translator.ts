import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type Messages } from "./messages/en";
import { tr } from "./messages/tr";
import type { TranslateFunction, TranslationKey, TranslationValues } from "./types";

const DICTIONARIES: Record<Locale, Messages> = {
  en,
  tr,
};

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

function interpolate(text: string, values?: TranslationValues): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    return key in values ? String(values[key]) : `{${key}}`;
  });
}

export function createTranslator(locale: Locale): TranslateFunction {
  const primaryDict = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];
  const fallbackDict = DICTIONARIES[DEFAULT_LOCALE];

  return (key: TranslationKey | string, values?: TranslationValues): string => {
    let raw = resolvePath(primaryDict as unknown as Record<string, unknown>, key);

    if (raw === undefined && locale !== DEFAULT_LOCALE) {
      raw = resolvePath(fallbackDict as unknown as Record<string, unknown>, key);
    }

    if (typeof raw === "string") {
      return interpolate(raw, values);
    }

    return key;
  };
}

export { en, tr };
