"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { setLocaleAction } from "@/app/actions/locale";
import { useLocale, useTranslations } from "./provider";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/shared/i18n";

export function LanguageSwitcher({
  className = "",
}: {
  className?: string;
}) {
  const currentLocale = useLocale();
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(newLocale: Locale) {
    if (newLocale === currentLocale || isPending) return;

    startTransition(async () => {
      await setLocaleAction(newLocale);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("nav.language")}
      className={`inline-flex items-center rounded-(--radius-sm) border border-border bg-surface-muted/50 p-0.5 text-xs ${className}`}
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const active = locale === currentLocale;
        return (
          <button
            key={locale}
            type="button"
            disabled={isPending}
            onClick={() => handleChange(locale)}
            className={`rounded-(--radius-xs) px-2 py-1 font-medium transition-colors ${
              active
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {LOCALE_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
