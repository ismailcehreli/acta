import Link from "next/link";

import { getLocale } from "@/server/i18n/locale";
import { getTranslations } from "@/server/i18n/server";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { splitHighlights, type SearchHit } from "@/server/search/activities";
import { formatDay, formatInstant } from "@/shared/format/date-time";





function Snippet({ snippet }: { snippet: string }) {
  return (
    <p className="mt-1.5 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
      {splitHighlights(snippet).map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-waiting-soft px-0.5 text-ink"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export async function SearchResults({
  hits,
  total,
  page,
  pageCount,
  pageAddress,
  query,
}: {
  hits: SearchHit[];
  total: number;
  page: number;
  pageCount: number;

  pageAddress: (page: number) => string;
  query: string;
}) {
  const locale = await getLocale();
  const t = await getTranslations(locale);
  if (query === "") {
    return (
      <Card>
        <EmptyState
          title={t("screens.search.emptyTitle")}
          description={t("screens.search.emptyDescription")}
        />
      </Card>
    );
  }

  if (total === 0) {
    return (
      <Card>
        <EmptyState
          title={t("screens.search.noResults", { query })}
          description={t("screens.search.noResultsDescription")}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      <p className="text-[length:var(--text-sm)] text-muted">
        {t("screens.search.resultsSummary", { total, page, pageCount })}
      </p>

      <ul className="flex flex-col gap-2">
        {hits.map((hit) => (
          <li key={hit.id} data-test="search-result">
            <Card className="transition-colors hover:border-line-strong">
              <div className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-2">

                  <span className="text-[length:var(--text-xs)] text-muted tabular">
                    #{hit.activityNo}
                  </span>
                  <Link
                    href={`/activities/${hit.id}`}
                    className={
                      hit.approvalStatus === "CANCELLED"
                        ? "font-medium text-ink line-through hover:text-primary"
                        : "font-medium text-ink hover:text-primary"
                    }
                  >
                    {hit.title}
                  </Link>
                  {hit.approvalStatus === "CANCELLED" ? (
                    <Badge>{t("screens.search.cancelled")}</Badge>
                  ) : null}
                </div>

                <p className="mt-0.5 text-[length:var(--text-xs)] text-muted">
                  {hit.authorName}
                  {hit.authorTitle ? ` · ${hit.authorTitle}` : ""} ·{" "}
                  {hit.authorUnitName} · {formatDay(hit.activityDate, locale)} ·{" "}
                  <span className="text-faint">
                    {t("screens.search.saved")} {formatInstant(hit.createdAt, locale)}
                  </span>
                </p>

                <Snippet snippet={hit.snippet} />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-end gap-2">
          {page > 1 ? (
            <ButtonLink size="sm" href={pageAddress(page - 1)}>
              {t("common.previous")}
            </ButtonLink>
          ) : null}
          {page < pageCount ? (
            <ButtonLink
              size="sm"
              href={pageAddress(page + 1)}
              data-test="next-page"
            >
              {t("common.next")}
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
