import Link from "next/link";
import { getTranslations } from "@/server/i18n/server";


//



//




function pageList(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const parts: (number | "...")[] = [1];
  const start = Math.max(2, current - 1);
  const last = Math.min(total - 1, current + 1);

  if (start > 2) parts.push("...");
  for (let i = start; i <= last; i += 1) parts.push(i);
  if (last < total - 1) parts.push("...");

  parts.push(total);
  return parts;
}

export async function Pagination({
  page,
  pageCount,
  hrefFor,
  totalLabel,
}: {

  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;

  totalLabel?: string;
}) {
  const t = await getTranslations();
  if (pageCount <= 1) {
    return totalLabel ? (
      <div className="border-t border-line px-4 py-3 text-[length:var(--text-xs)] text-faint sm:px-5">
        {totalLabel}
      </div>
    ) : null;
  }

  const pages = pageList(page, pageCount);

  return (
    <nav
      aria-label={t("common.pagination")}
      className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-line px-4 py-3 sm:px-5"
    >
      <Adim
        href={page > 1 ? hrefFor(page - 1) : null}
        label={`${t("common.previous")} ${t("common.page")}`}
      >
        ‹
      </Adim>

      <ul className="flex flex-wrap items-center gap-1">
        {pages.map((value, i) =>
          value === "..." ? (
            <li
              key={`bosluk-${i}`}
              aria-hidden
              className="px-1 text-[length:var(--text-sm)] text-faint"
            >
              …
            </li>
          ) : (
            <li key={value}>
              <Link
                href={hrefFor(value)}
                aria-current={value === page ? "page" : undefined}
                aria-label={`${t("common.page")} ${value}`}
                className={[
                  "flex min-h-9 min-w-9 items-center justify-center rounded-(--radius-xs) px-2",
                  "tabular text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
                  value === page
                    ? "bg-primary font-semibold text-white"
                    : "text-muted hover:bg-surface-hover hover:text-ink",
                ].join(" ")}
              >
                {value}
              </Link>
            </li>
          ),
        )}
      </ul>

      <Adim
        href={page < pageCount ? hrefFor(page + 1) : null}
        label={`${t("common.next")} ${t("common.page")}`}
      >
        ›
      </Adim>

      {totalLabel ? (
        <span className="ms-auto text-[length:var(--text-xs)] text-faint">
          {totalLabel}
        </span>
      ) : null}
    </nav>
  );
}

/** Render a previous/next step, muted when the link is unavailable. */
function Adim({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const baseClass =
    "flex min-h-9 min-w-9 items-center justify-center rounded-(--radius-xs) text-[length:var(--text-base)]";

  if (!href) {
    return (
      <span aria-hidden className={`${baseClass} text-line-strong`}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={`${baseClass} text-muted transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-ink`}
    >
      <span aria-hidden>{children}</span>
    </Link>
  );
}
