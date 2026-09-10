import Link from "next/link";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/shell/admin-nav";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import type { CurrentUser } from "@/server/auth/current-user";

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
  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={title}
          description={description}
          breadcrumbs={[
            { label: "Yönetim" },
            { label: "Sistem ayarları", href: "/admin/settings" },
            ...(section
              ? [{ label: SETTINGS_SECTIONS.find((item) => item.slug === section)?.label ?? title }]
              : []),
          ]}
        />

        <AdminNav isRoot={user.isRoot} />
        <SettingsSectionNav current={section} />
        {children}
      </Page>
    </AppShell>
  );
}

function SettingsSectionNav({ current }: { current?: SettingsSectionSlug }) {
  const currentLabel =
    current === undefined
      ? "Genel bakış"
      : SETTINGS_SECTIONS.find((item) => item.slug === current)?.label ?? "Ayarlar";

  return (
    <>
      <nav aria-label="Ayar bölümleri" className="hidden border-y border-line md:block">
        <ul className="flex overflow-x-auto">{sectionLinks(current)}</ul>
      </nav>

      <details className="border-y border-line md:hidden">
        <summary className="flex min-h-(--spacing-touch) cursor-pointer items-center justify-between gap-3 px-3 text-[length:var(--text-sm)] text-ink marker:text-muted">
          <span className="text-muted">Ayar bölümü</span>
          <span className="font-medium">{currentLabel}</span>
        </summary>
        <nav aria-label="Ayar bölümleri">
          <ul className="border-t border-line">{sectionLinks(current)}</ul>
        </nav>
      </details>
    </>
  );
}

function sectionLinks(current?: SettingsSectionSlug) {
  return [
    <li key="overview" className="shrink-0">
      <Link
        href="/admin/settings"
        aria-current={!current ? "page" : undefined}
        className={navClass(!current)}
      >
        Genel bakış
      </Link>
    </li>,
    ...SETTINGS_SECTIONS.map((item) => (
      <li key={item.slug} className="shrink-0">
        <Link
          href={`/admin/settings/${item.slug}`}
          aria-current={current === item.slug ? "page" : undefined}
          className={navClass(current === item.slug)}
        >
          {item.label}
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
