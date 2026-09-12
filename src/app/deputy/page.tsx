import { redirect } from "next/navigation";

import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import {
  countDeputyPeriods,
  listCoveredPeriods,
  listDeputyDecisions,
  listDeputyPeriods,
  type DeputyPeriod,
  type DeputyPeriodFilters,
} from "@/server/absence/deputy-read";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getLocale } from "@/server/i18n/locale";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { resolvePageSize } from "@/server/preferences/page-size";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { formatDay } from "@/shared/format/date-time";
import type { Locale } from "@/shared/i18n";

import { DecisionList } from "./decision-list";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.deputy.pageTitle");
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function periodLabel(
  start: Date,
  end: Date,
  locale: Parameters<typeof formatDay>[1],
): string {
  return `${formatDay(start, locale)} – ${formatDay(end, locale)}`;
}

export default async function DeputyPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; page?: string; pageSize?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);
  const params = await searchParams;
  const now = new Date();
  const filters: DeputyPeriodFilters = { personId: params.person || undefined };
  const pageSize = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;

  // Decisions are calculated from the complete delegation set; pagination
  // only applies to the period cards shown below.
  const [myDelegations, coveredByOthers, shellUser, totalPeriods] = await Promise.all([
    listDeputyPeriods(prisma, user.id, now),
    listCoveredPeriods(prisma, user.id),
    toShellUser(user),
    countDeputyPeriods(prisma, user.id, filters),
  ]);

  const pageCount = Math.max(1, Math.ceil(totalPeriods / pageSize));
  const currentPage = Math.min(page, pageCount);
  const listedPeriods = await listDeputyPeriods(prisma, user.id, now, filters, {
    limit: pageSize,
    skip: (currentPage - 1) * pageSize,
  });

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/deputy",
      { person: params.person, pageSize: String(pageSize) },
      attachment,
    );

  const people = [
    ...new Map(myDelegations.map((period) => [period.personId, period.personName])).entries(),
  ].map(([id, name]) => ({ value: id, label: name }));

  const decisions = await Promise.all(
    myDelegations.map(async (period) => ({
      period,
      decisions: await listDeputyDecisions(
        prisma,
        {
          personId: period.personId,
          deputyId: user.id,
          startDate: period.startDate,
          endDate: period.endDate,
        },
        user.id,
      ),
    })),
  );

  const coveredDecisions = await Promise.all(
    coveredByOthers.map(async (period) => ({
      period,
      decisions: await listDeputyDecisions(
        prisma,
        {
          personId: user.id,
          deputyId: period.personId,
          startDate: period.startDate,
          endDate: period.endDate,
        },
        user.id,
      ),
    })),
  );

  const activeDelegations = myDelegations.filter((period) => period.active);
  const activeDecisions = decisions.filter(({ period }) => period.active);
  const historyDecisions = decisions.filter(
    ({ period, decisions: list }) => !period.active && list.length > 0,
  );

  return (
    <AppShell user={shellUser}>
      <Page marker="delegations">
        <PageHeader
          title={t("screens.deputy.pageTitle")}
          description={t("screens.deputy.pageDescription")}
          breadcrumbs={[
            { label: t("screens.deputy.dashboard"), href: "/" },
            { label: t("screens.deputy.pageTitle") },
          ]}
        />

        {activeDelegations.length > 0 ? (
          <div
            data-test="active-delegation"
            className="border-y border-primary-line bg-primary-soft px-4 py-3.5 sm:px-5"
          >
            <p className="section-label text-primary">{t("screens.deputy.activeLabel")}</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {activeDelegations.map((period) => (
                <li key={period.id} className="text-[length:var(--text-sm)] text-ink">
                  <strong className="font-semibold">{period.personName}</strong> —{" "}
                  {period.personUnitName} · {periodLabel(period.startDate, period.endDate, locale)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {activeDecisions.map(({ period, decisions: list }) => (
          <Card key={`active-${period.id}`}>
            <CardHeader
              title={t("screens.deputy.decisionsFor", { person: period.personName })}
              description={t("screens.deputy.decisionsDescription")}
            />
            <DecisionList decisions={list} t={t} locale={locale} />
          </Card>
        ))}

        <Card>
          <CardHeader
            title={t("screens.deputy.periodsTitle")}
            description={t("screens.deputy.periodsDescription")}
          />
          <FilterBar
            action="/deputy"
            clearHref="/deputy"
            filtered={Boolean(params.person)}
            pageSize={pageSize}
            fields={[
              {
                name: "person",
                label: t("screens.deputy.personCovered"),
                value: params.person ?? "",
                width: "w-56",
                options: [{ value: "", label: t("screens.followUps.everyone") }, ...people],
              },
            ]}
          />

          <PeriodList
            periods={listedPeriods}
            emptyDescription={
              params.person ? t("screens.deputy.noMatch") : t("screens.deputy.noneCovered")
            }
            t={t}
            locale={locale}
          />

          <Pagination
            page={currentPage}
            pageCount={pageCount}
            hrefFor={(targetPage) =>
              targetPage === 1 ? address() : address({ page: String(targetPage) })
            }
          />
        </Card>

        {historyDecisions.map(({ period, decisions: list }) => (
          <Card key={`history-${period.id}`}>
            <details data-test="historical-delegation-decisions">
              <summary className="cursor-pointer list-none px-5 py-4 text-[length:var(--text-sm)] font-medium text-ink">
                {t("screens.deputy.decisionsFor", { person: period.personName })} ·{" "}
                {periodLabel(period.startDate, period.endDate, locale)}
              </summary>
              <DecisionList decisions={list} t={t} locale={locale} />
            </details>
          </Card>
        ))}

        <Card>
          <CardHeader
            title={t("screens.deputy.myDeputies")}
            description={t("screens.deputy.myDeputiesDescription")}
          />
          <PeriodList
            periods={coveredByOthers}
            emptyDescription={t("screens.deputy.noDeputy")}
            t={t}
            locale={locale}
          />
        </Card>

        {coveredDecisions
          .filter(({ decisions: list }) => list.length > 0)
          .map(({ period, decisions: list }) => (
            <Card key={`covered-${period.id}`}>
              <details data-test="covered-delegation-decisions">
                <summary className="cursor-pointer list-none px-5 py-4 text-[length:var(--text-sm)] font-medium text-ink">
                  {t("screens.deputy.coveredFor", { person: period.personName })} ·{" "}
                  {periodLabel(period.startDate, period.endDate, locale)}
                </summary>
              <DecisionList decisions={list} t={t} locale={locale} />
              </details>
            </Card>
          ))}
      </Page>
    </AppShell>
  );
}

function PeriodList({
  periods,
  emptyDescription,
  t,
  locale,
}: {
  periods: DeputyPeriod[];
  emptyDescription: string;
  t: Translator;
  locale: Locale;
}) {
  if (periods.length === 0) {
    return <EmptyState title={t("screens.deputy.noRecords")} description={emptyDescription} />;
  }

  return (
    <RecordList>
      {periods.map((period) => (
        <RecordItem key={period.id} data-test="delegation-period" className="sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{period.personName}</span>
              <span className="text-[length:var(--text-sm)] text-muted">
                {period.personUnitName}
              </span>
              {period.active ? <Badge tone="primary">{t("screens.deputy.ongoing")}</Badge> : null}
            </p>
            <span className="text-[length:var(--text-sm)] text-muted">
              {t("screens.deputy.decisionCount", { count: period.decisionCount })}
            </span>
          </div>

          <p className="mt-1 text-[length:var(--text-xs)] text-faint">
            {periodLabel(period.startDate, period.endDate, locale)}
            {period.note ? ` · ${period.note}` : ""}
          </p>
        </RecordItem>
      ))}
    </RecordList>
  );
}
