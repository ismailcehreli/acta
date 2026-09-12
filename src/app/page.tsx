import { redirect } from "next/navigation";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { countVisibleActivities } from "@/server/authz/activity-repository";
import {
  countScopeActivities,
  describeScope,
  listScopeActivities,
  periodStart,
  type FeedFilters,
} from "@/server/activities/scope-feed";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { subordinateUserIds } from "@/server/authz/visibility";
import { activityTrend, statusDistribution } from "@/server/dashboard/charts";
import { listWorkQueue } from "@/server/dashboard/work-queue";
import { departmentSummary } from "@/server/dashboard/department-summary";
import {
  dashboardMetrics,
  personalDashboardMetrics,
} from "@/server/dashboard/metrics";
import {
  operationsSummary,
  teamParticipationToday,
} from "@/server/dashboard/summary";
import { prisma } from "@/server/db";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { ManagerSummaryBlock } from "@/components/dashboard/manager-summary";
import { MyActivitiesBlock } from "@/components/dashboard/my-activities-block";
import { OperationsBlock } from "@/components/dashboard/operations-block";
import { WorkQueueBlock } from "@/components/dashboard/work-queue-block";
import { UnreadActivitiesBlock } from "@/components/dashboard/unread-activities-block";
import { FeedRow } from "@/components/dashboard/scope-feed";
import { FeedPreview, SummaryCharts } from "@/components/dashboard/summary-charts";
import { TeamBlock } from "@/components/dashboard/team-block";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { companyHour } from "@/shared/format/date-time";



//




//








function parsePeriod(value: string | undefined): FeedFilters["period"] {
  return value === "today" || value === "all" || value === "week" ? value : "week";
}

import { getTranslations } from "@/server/i18n/server";
import type { TranslateFunction } from "@/shared/i18n";


const PREVIEW_LIMIT = 5;


const TREND_DAYS = 14;

function greeting(now: Date, t: TranslateFunction): string {
  const hour = companyHour(now);

  if (hour < 12) return t("dashboard.greetingMorning");
  if (hour < 18) return t("dashboard.greetingAfternoon");
  return t("dashboard.greetingEvening");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const params = await searchParams;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };
  const now = new Date();

  const filters: FeedFilters = { period: parsePeriod(params.period) };
  const period = filters.period ?? "week";



  const subordinates = await subordinateUserIds(prisma, viewer.id);

  const [
    scope,
    preview,
    totalRecord,
    todayCount,
    totalCount,
    workQueue,
    unreadPreview,
    participation,
    departmentRows,
    operations,
    personalMetrics,
    managedMetrics,
    trend,
    statuses,
  ] = await Promise.all([
    describeScope(prisma, viewer, subordinates),
    listScopeActivities(prisma, viewer, filters, now, {
      subordinates,
      limit: PREVIEW_LIMIT,
      managedOnly: true,
    }),
    countScopeActivities(prisma, viewer, filters, now, {
      subordinates,
      managedOnly: true,
    }),
    countVisibleActivities(prisma, viewer, {
      authorId: user.id,
      activityDate: toDateValue(companyDay(now)),
    }),
    countVisibleActivities(prisma, viewer, { authorId: user.id }),


    listWorkQueue(prisma, viewer, now),
    listScopeActivities(prisma, viewer, { period: "all", unreadOnly: true }, now, {
      subordinates,
      limit: PREVIEW_LIMIT,
      managedOnly: true,
      order: "oldest",
    }),
    teamParticipationToday(prisma, subordinates, now),
    departmentSummary(prisma, viewer, subordinates, filters.period, now, {
      includeRoot: true,
      locale,
    }),
    user.isSystemAdmin ? operationsSummary(prisma, now) : Promise.resolve(null),
    personalDashboardMetrics(prisma, viewer, filters.period, now),
    dashboardMetrics(prisma, viewer, subordinates, filters.period, now, {
      canManageAbsences: user.isUnitManager,
      canManageFeedback: user.isSystemAdmin,
    }),
    activityTrend(prisma, viewer, subordinates, TREND_DAYS, now, {
      managedOnly: true,
    }),
    statusDistribution(
      prisma,
      viewer,
      subordinates,
      periodStart(filters.period, now),
      { managedOnly: true },
    ),
  ]);

  const shellUser = await toShellUser(user, subordinates);
  const pending = workQueue.items.length;




  const writesActivities = user.writesActivities;

  const periodLabels: Record<"today" | "week" | "all", string> = {
    today: t("dashboard.periodToday"),
    week: t("dashboard.periodWeek"),
    all: t("dashboard.periodAll"),
  };

  const feedAddress = `/feed?${new URLSearchParams({ period }).toString()}`;

  return (
    <AppShell user={shellUser}>
      <Page marker="dashboard">
        <PageHeader
          marker={t("nav.today")}
          title={`${greeting(now, t)}, ${user.fullName}`}
          description={
            [
              !writesActivities
                ? null
                : todayCount === 0
                  ? t("dashboard.noActivityToday")
                  : t("dashboard.youWroteCount", { count: todayCount }),
              pending > 0 ? t("dashboard.pendingTasksCount", { count: pending }) : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />

        <WorkQueueBlock items={workQueue.items} watched={workQueue.watched} />

        {scope.hasScope && shellUser.unreadCount > 0 ? (
          <UnreadActivitiesBlock
            items={unreadPreview.items}
            count={shellUser.unreadCount}
            href="/feed?period=all&unread=1"
          />
        ) : null}

        <section
          aria-labelledby="personal-overview"
          data-test="personal-overview"
          className="flex flex-col gap-(--spacing-block)"
        >
          <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
            <div>
              <span className="section-label">{t("dashboard.personalSummary")}</span>
              <h2 id="personal-overview" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                {t("dashboard.myStatus")}
              </h2>
            </div>
            <p className="max-w-sm text-right text-[length:var(--text-sm)] text-muted">
              {t("dashboard.onlyYourActivities")}
            </p>
          </div>

          <MetricStrip
            metrics={personalMetrics}
            periodLabel={periodLabels[period]}
            period={period}
            isApprover={false}
            headingId="personal-metrics-heading"
            ownOnly
            authorId={user.id}
          />

          {/* ── Today's record ─────────────────────────────────────────
            A thin strip that does not compete with the work. It is hidden for
            people who are not expected to log activities (§7.4 exception), even
            when the count is zero. */}
          {writesActivities ? (
            <MyActivitiesBlock todayCount={todayCount} totalCount={totalCount} />
          ) : null}
        </section>

        {subordinates.length > 0 ? (
          <section
            aria-labelledby="managed-area"
            data-test="managed-area"
            className="flex flex-col gap-(--spacing-block)"
          >
            <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
              <div>
                <span className="section-label">{t("dashboard.managedArea")}</span>
                <h2 id="managed-area" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                  {t("dashboard.myManagedArea")}
                </h2>
              </div>
              <p className="max-w-sm text-right text-[length:var(--text-sm)] text-muted">
                {t("dashboard.subordinatesAggregate")}
              </p>
            </div>

            <MetricStrip
              metrics={managedMetrics}
              periodLabel={periodLabels[period]}
              period={period}
              isApprover={user.isUnitManager}
            headingId="managed-metrics-heading"
            />

            <ManagerSummaryBlock
              pendingAbsence={managedMetrics.pendingAbsence}
              newFeedback={managedMetrics.newFeedback}
            />

            {participation ? <TeamBlock participation={participation} /> : null}

            {/* ── Visual summary ───────────────────────────────────────
            No chart is rendered without scope: a one-person distribution is
            decoration rather than information. */}
            {scope.hasScope ? (
              <SummaryCharts
                trend={trend}
                departments={departmentRows}
                statuses={statuses}
                period={period}
                periodLabel={periodLabels[period]}
              />
            ) : null}

            {/* ── Recent records ────────────────────────────────────────
            The complete feed has its own page; this is only the entry point. */}
            {scope.hasScope ? (
              <FeedPreview
                href={feedAddress}
                count={totalRecord}
                label={t(scope.label)}
                previewCount={PREVIEW_LIMIT}
              >
                {preview.items.length === 0 ? (
                  <EmptyState
                    title={t("dashboard.noActivitiesInRange")}
                    description={t("dashboard.tryExpandingPeriod")}
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {preview.items.map((item) => (
                      <FeedRow key={item.id} item={item} locale={locale} t={t} />
                    ))}
                  </ul>
                )}
              </FeedPreview>
            ) : null}
          </section>
        ) : (
          // Use the same text-heading pattern as the sibling sections (PERSONAL
          // SUMMARY / MANAGED AREA), not a separate Card: there is no data to
          // display here, only an explanation of why the scope is empty. Another
          // visual pattern would imply a different meaning (DESIGN-IS-2026-09-02,
          // Task 15.3).
          <section
            aria-labelledby="managed-area-empty"
            data-test="managed-area-empty"
            className="flex flex-col gap-(--spacing-block)"
          >
            <div className="border-b border-line pb-3">
              <span className="section-label">{t("dashboard.managedArea")}</span>
              <h2 id="managed-area-empty" className="mt-1 text-[length:var(--text-xl)] font-semibold text-ink">
                {t("dashboard.myManagedArea")}
              </h2>
            </div>
            <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
              {t("dashboard.noScopeDescription")}
            </p>
          </section>
        )}

        {operations ? <OperationsBlock summary={operations} /> : null}
      </Page>
    </AppShell>
  );
}
