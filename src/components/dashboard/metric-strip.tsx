import Link from "next/link";

import type { DashboardMetrics } from "@/server/dashboard/metrics";
import { getTranslations } from "@/server/i18n/server";


//



// The metric strip is intentionally rendered without a heading.
//



//






//





interface Metric {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  tone?: "primary" | "correction" | "danger";
}

export async function MetricStrip({
  metrics: dashboardMetrics,
  periodLabel,
  period,
  isApprover,
  headingId = "metrics-heading",
  ownOnly = false,
  authorId,
}: {
  metrics: DashboardMetrics;
  periodLabel: string;

  period: string;

  isApprover: boolean;

  headingId?: string;

  ownOnly?: boolean;

  authorId?: string;
}) {


  const t = await getTranslations();
  const feedAddress = (attachment: Record<string, string> = {}) =>
    `/feed?${new URLSearchParams({
      period,
      ...attachment,
    }).toString()}`;
  const ownArchiveAddress = (attachment: Record<string, string> = {}) =>
    `/activities?${new URLSearchParams({ period, ...attachment }).toString()}`;
  const listAddress = (attachment: Record<string, string> = {}) =>
    ownOnly ? ownArchiveAddress(attachment) : feedAddress(attachment);

  const metricCards: Metric[] = [
    {
      label: t("screens.dashboard.activitiesWritten", { period: periodLabel }),
      value: dashboardMetrics.activities,
      hint:
        dashboardMetrics.contributors > 0
          ? t("screens.dashboard.peopleWrote", { count: dashboardMetrics.contributors })
          : t("screens.dashboard.noRecords"),
      href: listAddress(),
    },
    {
      label: t("screens.dashboard.pendingApproval"),
      value: dashboardMetrics.pendingApproval,
      hint: isApprover
        ? t("screens.dashboard.waitingForDecision")
        : t("screens.dashboard.assignedToManager"),
      // Approvers go to the approval queue; other users see the same records
      // in the managed feed. Personal metrics always link to the own archive.
      href: !ownOnly && isApprover ? "/approvals" : listAddress({ status: "approval" }),
      tone: "primary",
    },
    {
      label: t("screens.dashboard.changesRequested"),
      value: dashboardMetrics.correctionRequested,
      hint: t("screens.dashboard.waitingForResubmission"),
      href: listAddress({ status: "changesRequested" }),
      tone: "correction",
    },
    {
      label: t("screens.dashboard.awaitingAnswers"),
      value: dashboardMetrics.openQuestions,
      hint: t("screens.dashboard.openQuestionsHint"),
      // Open questions are independent of the selected period.
      href: listAddress({ period: "all", status: "questions" }),
      tone: "primary",
    },
    {
      label: t("screens.dashboard.openFollowUp"),
      value: dashboardMetrics.openFollowUps,
      hint:
        dashboardMetrics.staleFollowUps > 0
          ? t("screens.dashboard.staleFollowUps", {
              count: dashboardMetrics.staleFollowUps,
              days: dashboardMetrics.staleThreshold,
            })
          : t("screens.dashboard.noStaleFollowUps", { days: dashboardMetrics.staleThreshold }),
      href: ownOnly && authorId
        ? `/follow-ups?assigneeId=${encodeURIComponent(authorId)}`
        : "/follow-ups",
      tone: dashboardMetrics.staleFollowUps > 0 ? "danger" : "primary",
    },
  ];

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {t("screens.dashboard.metricsHeading")}
      </h2>
      <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-5">
        {metricCards.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </dl>
    </section>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  const activeTone = metric.value > 0 && metric.tone;
  const color =
    activeTone === "danger"
      ? "text-danger"
      : activeTone === "correction"
        ? "text-correction"
        : activeTone === "primary"
          ? "text-primary"
          : "text-ink";

  const content = (
    <>
      <dt className="section-label">{metric.label}</dt>
      <dd className={`mt-1 text-[length:var(--text-2xl)] font-semibold tabular ${color}`}>
        {metric.value}
      </dd>
      {metric.hint ? (
        <p className="mt-0.5 text-[length:var(--text-2xs)] leading-[var(--leading-snug)] text-faint">
          {metric.hint}
        </p>
      ) : null}
    </>
  );

  // Zero-count metrics remain links so users can inspect or clear the filter.
  if (metric.href) {
    return (
      <div className="border-line not-last:border-e">
        <Link
          href={metric.href}
          className="block px-3 py-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
        >
          {content}
        </Link>
      </div>
    );
  }

  return <div className="border-line px-3 py-3 not-last:border-e">{content}</div>;
}
