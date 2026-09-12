import Link from "next/link";
import { redirect } from "next/navigation";

import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { prisma } from "@/server/db";
import {
  listFollowUps,
  type FollowUpFilters,
  type FollowUpView,
} from "@/server/follow-ups/read";
import { listScopePeople } from "@/server/activities/scope-feed";
import { subordinateUserIds } from "@/server/authz/visibility";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { formatDay } from "@/shared/format/date-time";
import type { Locale } from "@/shared/i18n";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.followUps.pageTitle");
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function Row({
  item,
  t,
  locale,
}: {
  item: FollowUpView;
  t: Translator;
  locale: Locale;
}) {
  return (
    <li data-test="follow-up-record" data-stale={item.stale ? "true" : "false"}>
      <Link
        href={`/activities/${item.activityId}`}
        className="flex flex-col gap-0.5 rounded-(--radius-sm) px-2 py-2.5 transition-colors hover:bg-inset"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[length:var(--text-xs)] text-muted tabular">
            #{item.activityNo}
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-ink">
            {item.activityTitle}
          </span>
          {item.stale ? (
            <Badge tone="danger">
              {t("screens.followUps.staleBadge", { days: item.idleBusinessDays })}
            </Badge>
          ) : null}
          {item.mine ? <Badge tone="primary">{t("screens.followUps.mine")}</Badge> : null}
          {item.reviewOverdue ? (
            <Badge tone="correction">{t("screens.followUps.reviewOverdue")}</Badge>
          ) : null}
        </span>

        {item.nextStep ? (
          <span className="text-[length:var(--text-xs)] text-muted">
            {t("screens.followUps.nextStep")} {item.nextStep}
          </span>
        ) : null}

        <span className="flex flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-muted">
          <Avatar
            user={{
              id: item.ownerId,
              fullName: item.ownerName,
              avatarExtension: item.ownerAvatarExtension,
            }}
            size={18}
          />
          {item.ownerName}
          {" · "}
          <span className={item.stale ? "text-correction" : undefined}>
            {item.idleBusinessDays === 0
              ? t("screens.followUps.activeToday")
              : t("screens.followUps.inactiveFor", { days: item.idleBusinessDays })}
          </span>
          {item.reviewDate
            ? ` · ${t("screens.followUps.reviewDate", { date: formatDay(item.reviewDate, locale) })}`
            : ""}
        </span>
      </Link>
    </li>
  );
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    assigneeId?: string;
    stale?: string;
    period?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);
  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FollowUpFilters = {
    status: params.status === "closed" ? "CLOSED" : "OPEN",
    ownerId: params.assigneeId || undefined,
    staleOnly: params.stale === "true" || undefined,
    period:
      params.period === "today" || params.period === "week" ? params.period : "all",
  };

  const pageSize = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const subordinates = await subordinateUserIds(prisma, user.id);

  // Load the full filtered set once to calculate pagination. Inactivity is
  // tied to the work calendar, so the query is already materialized in memory.
  const initial = await listFollowUps(prisma, viewer, now, filters);
  const pageCount = Math.max(1, Math.ceil(initial.total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const items = initial.items.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const [shellUser, people] = await Promise.all([
    toShellUser(user, subordinates),
    listScopePeople(prisma, viewer, subordinates),
  ]);

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/follow-ups",
      {
        status: params.status,
        assigneeId: params.assigneeId,
        stale: params.stale,
        period: params.period,
        pageSize: String(pageSize),
      },
      attachment,
    );

  const isFiltered =
    Boolean(params.status) ||
    Boolean(params.assigneeId) ||
    Boolean(params.stale) ||
    (params.period ?? "all") !== "all";
  const closed = filters.status === "CLOSED";

  return (
    <AppShell user={shellUser}>
      <Page marker="follow-ups">
        <PageHeader
          title={t("screens.followUps.pageTitle")}
          description={t("screens.followUps.pageDescription")}
          breadcrumbs={[
            { label: t("screens.followUps.dashboard"), href: "/" },
            { label: t("screens.followUps.pageTitle") },
          ]}
        />

        <Card>
          <CardHeader
            title={closed ? t("screens.followUps.closedItems") : t("screens.followUps.openItems")}
            description={
              closed
                ? t("screens.followUps.closedDescription")
                : t("screens.followUps.openDescription", { days: initial.staleThreshold })
            }
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {t("screens.followUps.itemCount", { count: initial.total })}
              </span>
            }
          />

          <FilterBar
            action="/follow-ups"
            clearHref="/follow-ups"
            filtered={isFiltered}
            pageSize={pageSize}
            fields={[
              {
                name: "status",
                label: t("screens.followUps.status"),
                value: params.status ?? "open",
                width: "w-36",
                options: [
                  { value: "open", label: t("screens.followUps.open") },
                  { value: "closed", label: t("screens.followUps.closed") },
                ],
              },
              {
                name: "assigneeId",
                label: t("screens.followUps.assignee"),
                value: params.assigneeId ?? "",
                options: [
                  { value: "", label: t("screens.followUps.everyone") },
                  ...people.map((person) => ({ value: person.id, label: person.fullName })),
                ],
              },
              {
                name: "stale",
                label: t("screens.followUps.inactivity"),
                value: params.stale ?? "",
                width: "w-48",
                options: [
                  { value: "", label: t("screens.followUps.everyone") },
                  {
                    value: "true",
                    label: t("screens.followUps.staleOption", { days: initial.staleThreshold }),
                  },
                ],
              },
              {
                name: "period",
                label: t("screens.followUps.openingPeriod"),
                value: params.period ?? "all",
                width: "w-36",
                options: [
                  { value: "all", label: t("screens.followUps.all") },
                  { value: "today", label: t("screens.followUps.today") },
                  { value: "week", label: t("screens.followUps.week") },
                ],
              },
            ]}
          />

          {items.length === 0 ? (
            isFiltered ? (
              <EmptyState
                title={t("screens.followUps.filterNoMatch")}
                description={t("screens.followUps.clearFilters")}
              />
            ) : (
              <EmptyState
                title={t("screens.followUps.noOpenItems")}
                description={t("screens.followUps.noOpenItemsDescription")}
              />
            )
          ) : (
            <CardBody className="py-2">
              <ul className="flex flex-col">
                {items.map((item) => (
                  <Row key={item.id} item={item} t={t} locale={locale} />
                ))}
              </ul>
            </CardBody>
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
