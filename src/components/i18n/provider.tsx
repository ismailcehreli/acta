"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  createTranslator,
  type Locale,
  type TranslateFunction,
} from "@/shared/i18n";

interface I18nContextType {
  locale: Locale;
  t: TranslateFunction;
}

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    return {
      locale,
      t: createTranslator(locale),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslations(): TranslateFunction {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
