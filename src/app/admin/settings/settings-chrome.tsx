import Link from "next/link";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/shell/admin-nav";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import type { CurrentUser } from "@/server/auth/current-user";
import { getTranslations } from "@/server/i18n/server";
import type { TranslateFunction } from "@/shared/i18n";

import { SETTINGS_SECTIONS, type SettingsSectionSlug } from "./settings-sections";

export async function SettingsChrome({
  user,
  section,
  title,
  description,
  children,
}: {
  user: CurrentUser;
  section?: SettingsSectionSlug;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const t = await getTranslations();
  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={title}
          description={description}
          breadcrumbs={[
            { label: t("nav.adminGroup") },
            { label: t("screens.settingsPage.title"), href: "/admin/settings" },
            ...(section
              ? [{ label: t(SETTINGS_SECTIONS.find((item) => item.slug === section)?.labelKey ?? "screens.settingsPage.title") }]
              : []),
          ]}
        />

        <AdminNav isRoot={user.isRoot} />
        <SettingsSectionNav current={section} t={t} />
        {children}
      </Page>
    </AppShell>
  );
}

function SettingsSectionNav({
  current,
  t,
}: {
  current?: SettingsSectionSlug;
  t: TranslateFunction;
}) {
  const currentLabel =
    current === undefined
      ? t("screens.settingsPage.overview")
      : t(SETTINGS_SECTIONS.find((item) => item.slug === current)?.labelKey ?? "screens.settingsPage.title");

  return (
    <>
      <nav aria-label={t("screens.settingsPage.title")} className="hidden border-y border-line md:block">
        <ul className="flex overflow-x-auto">{sectionLinks(current, t)}</ul>
      </nav>

      <details className="border-y border-line md:hidden">
        <summary className="flex min-h-(--spacing-touch) cursor-pointer items-center justify-between gap-3 px-3 text-[length:var(--text-sm)] text-ink marker:text-muted">
          <span className="text-muted">{t("screens.settingsPage.title")}</span>
          <span className="font-medium">{currentLabel}</span>
        </summary>
        <nav aria-label={t("screens.settingsPage.title")}>
          <ul className="border-t border-line">{sectionLinks(current, t)}</ul>
        </nav>
      </details>
    </>
  );
}

function sectionLinks(current: SettingsSectionSlug | undefined, t: TranslateFunction) {
  return [
    <li key="overview" className="shrink-0">
      <Link
        href="/admin/settings"
        aria-current={!current ? "page" : undefined}
        className={navClass(!current)}
      >
        {t("screens.settingsPage.overview")}
      </Link>
    </li>,
    ...SETTINGS_SECTIONS.map((item) => (
      <li key={item.slug} className="shrink-0">
        <Link
          href={`/admin/settings/${item.slug}`}
          aria-current={current === item.slug ? "page" : undefined}
          className={navClass(current === item.slug)}
        >
          {t(item.labelKey)}
        </Link>
      </li>
    )),
  ];
}

function navClass(active: boolean): string {
  return [
    "relative flex min-h-(--spacing-touch) items-center px-3 text-[length:var(--text-sm)]",
    active ? "font-semibold text-ink" : "text-muted hover:text-ink",
  ].join(" ");
}
