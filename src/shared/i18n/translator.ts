import {
  DEFAULT_LOCALE,
  LOCALE_DICTIONARIES,
  type Locale,
} from "./config";
import type {
  TranslateFunction,
  TranslationKey,
  TranslationValues,
} from "./types";

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
  const primaryDict =
    LOCALE_DICTIONARIES[locale] || LOCALE_DICTIONARIES[DEFAULT_LOCALE];
  const fallbackDict = LOCALE_DICTIONARIES[DEFAULT_LOCALE];

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

export { en } from "./messages/en";
export { tr } from "./messages/tr";
