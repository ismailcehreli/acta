import type { Metadata } from "next";

import { prisma } from "@/server/db";
import { DEFAULT_PAGE_TITLE, readBranding } from "@/server/settings/branding";
import { getLocale } from "@/server/i18n/locale";
import { LOCALE_LANGUAGE_TAGS } from "@/shared/i18n";
import { getTranslations } from "@/server/i18n/server";
import { I18nProvider } from "@/components/i18n/provider";

import "./globals.css";

/**
 * The tab title comes from settings. A hard-coded title left branding
 * half-finished: the logo changed while the tab kept the default name.
 *
 * If the database is unavailable, the default title is used. This happens in
 * two real situations:
 *
 * 1. Next may statically generate `/_not-found` without `DATABASE_URL` during
 *    the image build.
 * 2. The error page must remain renderable when the database is down.
 *
 * The error is logged rather than swallowed so an unexpected default title is
 * diagnosable.
 */
export async function generateMetadata(): Promise<Metadata> {
  let pageTitle = DEFAULT_PAGE_TITLE;
  const t = await getTranslations();

  try {
    pageTitle = (await readBranding(prisma)).pageTitle;
  } catch (error) {
    console.error(
      "[branding] Could not read page title; using default:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    title: { default: pageTitle, template: `%s · ${pageTitle}` },
    description: t("common.appSubtitle"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations(locale);

  return (
    <html lang={LOCALE_LANGUAGE_TAGS[locale]}>
      <body>
        <I18nProvider locale={locale}>
          {/* Keyboard navigation skip link */}
          <a
            href="#content"
            className="sr-only-focusable absolute start-3 top-3 z-[var(--z-toast)] rounded-(--radius-sm) bg-ink px-3 py-2 text-[length:var(--text-sm)] font-medium text-surface"
          >
            {t("common.skipToContent")}
          </a>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
