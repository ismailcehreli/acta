import { redirect } from "next/navigation";

import {
  countDrafts,
  listDrafts,
  type DraftFilters,
} from "@/server/activities/drafts";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { RecordItem, RecordList } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { resolvePageSize } from "@/server/preferences/page-size";

import { DeleteDraftButton } from "./delete-draft-button";
import { formatDay, formatInstantShort } from "@/shared/format/date-time";


//


//




//


//



export async function generateMetadata() {
  return getLocalizedMetadata("screens.drafts.pageTitle");
}


function preview(text: string): string {
  const tek = text.replace(/\s+/g, " ").trim();
  return tek.length > 160 ? `${tek.slice(0, 160)}…` : tek;
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    record?: string;
    type?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const params = await searchParams;
  const { record } = params;

  // Unknown values are ignored so an old link cannot break the page.
  const filters: DraftFilters =
    params.type === "manual"
      ? { savedManually: true }
      : params.type === "automatic"
        ? { savedManually: false }
        : {};

  const PAGE_SIZE = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;

  const [total, shellUser] = await Promise.all([
    countDrafts(prisma, user.id, filters),
    toShellUser(user),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const drafts = await listDrafts(prisma, user.id, filters, {
    limit: PAGE_SIZE,
    skip: (currentPage - 1) * PAGE_SIZE,
  });

  /** Preserve the filter while building pagination and page-size links. */
  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress("/drafts", { type: params.type, pageSize: String(PAGE_SIZE) }, attachment);

  const isFiltered = Boolean(params.type);

  return (
    <AppShell user={shellUser}>
      <Page marker="drafts">
        <PageHeader
          marker={t("screens.drafts.pageTitle")}
          title={t("screens.drafts.pageTitle")}
          description={t("screens.drafts.pageDescription")}
          breadcrumbs={[
            { label: t("screens.drafts.dashboard"), href: "/" },
            { label: t("screens.drafts.pageTitle") },
          ]}
          action={
            <ButtonLink href="/activities/new" variant="primary">
              {t("screens.drafts.newActivity")}
            </ButtonLink>
          }
        />

        {record ? (
          <div id="draft-message" role="status">
            <Alert tone="success">
              {record === "draft"
                ? t("screens.drafts.savedMessage")
                : record === "deleted"
                  ? t("screens.drafts.deletedMessage")
                  : t("screens.drafts.completed")}
            </Alert>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title={t("screens.drafts.pendingTitle")}
            description={t("screens.drafts.pendingDescription")}
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {t("screens.drafts.draftCount", { count: total })}
              </span>
            }
          />

          <FilterBar
            action="/drafts"
            clearHref="/drafts"
            filtered={isFiltered}
            pageSize={PAGE_SIZE}
            fields={[
              {
                name: "type",
                label: t("screens.drafts.recordType"),
                value: params.type ?? "",
                width: "w-52",
                options: [
                  { value: "", label: t("screens.drafts.allTypes") },
                  { value: "manual", label: t("screens.drafts.manuallySaved") },
                  { value: "automatic", label: t("screens.drafts.automaticallySaved") },
                ],
              },
            ]}
          />

          {drafts.length === 0 ? (
            isFiltered ? (
              <EmptyState
                title={t("screens.drafts.noFilterMatch")}
                description={t("screens.drafts.clearFilterDescription")}
                action={
                  <ButtonLink href="/drafts" variant="secondary" size="sm">
                    {t("screens.drafts.clearFilter")}
                  </ButtonLink>
                }
              />
            ) : (
            <EmptyState
              title={t("screens.drafts.noDrafts")}
              description={t("screens.drafts.noDraftsDescription")}
              action={
                <ButtonLink href="/activities/new" variant="primary" size="sm">
                  {t("screens.drafts.startActivity")}
                </ButtonLink>
              }
            />
            )
          ) : (
            <RecordList>
              {drafts.map((draft) => (
                <RecordItem
                  key={draft.id}
                  data-test="draft-record"
                  className="transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span
                          className={
                            draft.title.trim() === ""
                              ? "text-[length:var(--text-base)] font-medium text-faint italic"
                              : "text-[length:var(--text-base)] font-medium text-ink"
                          }
                        >
                          {draft.title.trim() === ""
                            ? t("screens.drafts.untitled")
                            : draft.title}
                        </span>
                        {draft.savedManually ? (
                          <Badge tone="waiting">{t("screens.drafts.waiting")}</Badge>
                        ) : (
                          <Badge tone="neutral">{t("screens.drafts.automatic")}</Badge>
                        )}
                      </div>

                      {draft.description.trim() !== "" ? (
                        <p className="prose-measure mt-1 text-[length:var(--text-sm)] text-muted">
                          {preview(draft.description)}
                        </p>
                      ) : null}

                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-faint">
                        <span>
                          {t("screens.drafts.activityDate")}: {formatDay(draft.activityDate, locale)}
                        </span>
                        <span aria-hidden className="text-line-strong">
                          ·
                        </span>
                        <span>
                          {t("screens.drafts.lastSaved")}: {formatInstantShort(draft.updatedAt, locale)}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <ButtonLink
                        href={`/activities/new?draft=${draft.id}`}
                        variant="primary"
                        size="sm"
                      >
                        {t("screens.drafts.continue")}
                      </ButtonLink>
                      <DeleteDraftButton
                        id={draft.id}
                        title={draft.title.trim() === ""
                          ? t("screens.drafts.untitled")
                          : draft.title}
                      />
                    </div>
                  </div>
                </RecordItem>
              ))}
            </RecordList>
          )}

          <Pagination
            page={currentPage}
            pageCount={pageCount}
            hrefFor={(targetPage) =>
              targetPage === 1 ? address() : address({ page: String(targetPage) })
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
