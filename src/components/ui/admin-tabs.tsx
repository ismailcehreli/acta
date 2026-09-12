import Link from "next/link";
import { getTranslations } from "@/server/i18n/server";

export interface AdminTab {
  href: string;
  label: string;
  hint?: string;
}


export async function AdminTabs({
  tabs,
  activeHref,
}: {
  tabs: AdminTab[];
  activeHref: string;
}) {
  const t = await getTranslations();
  return (
    <nav aria-label={t("nav.allSections")} className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.href === activeHref;

          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-(--spacing-touch) flex-col justify-center px-3.5",
                  "text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
                  active ? "font-semibold text-ink" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {tab.hint ? (
                  <span className="text-[length:var(--text-xs)] font-normal text-faint">
                    {tab.hint}
                  </span>
                ) : null}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0 h-[2px] bg-primary"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
