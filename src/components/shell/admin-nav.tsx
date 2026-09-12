"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "@/components/i18n";
import type { TranslationKey } from "@/shared/i18n";


//




//



const SECTIONS = [
  { href: "/admin/org", labelKey: "nav.orgTree" },
  { href: "/admin/users", labelKey: "nav.users" },
  { href: "/admin/calendar", labelKey: "nav.calendar" },
  { href: "/admin/approval-reasons", labelKey: "nav.approvalReasons" },
  { href: "/admin/settings", labelKey: "nav.settings" },
  { href: "/admin/jobs", labelKey: "nav.jobs" },
  { href: "/admin/audit", labelKey: "nav.audit" },
];


const ROOT_SECTIONS = [{ href: "/admin/activity-deletion", labelKey: "nav.activityDeletion" }];

export function AdminNav({ isRoot = false }: { isRoot?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations();
  const sections = isRoot ? [...SECTIONS, ...ROOT_SECTIONS] : SECTIONS;

  return (
    <nav
      aria-label={t("nav.adminSections")}
      className="-mx-4 border-y border-line bg-raised sm:-mx-7"
    >
      <ul className="flex overflow-x-auto px-4 sm:px-7">
        {sections.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);

          return (
            <li key={section.href} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-(--spacing-touch) items-center px-3.5",
                  "text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
                  active
                    ? "font-semibold text-ink"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {t(section.labelKey as TranslationKey)}
                {/* The active section is marked with an underline as well as color. */}
                {active ? (
                  <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-primary" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
