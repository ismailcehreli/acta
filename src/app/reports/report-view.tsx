import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "@/server/i18n/server";
import {
  LOCALE_LANGUAGE_TAGS,
  type Locale,
  type TranslateFunction,
} from "@/shared/i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Page, Stat, StatStrip } from "@/components/ui/page";
import {
  UnitSummaryTable,
  type UnitSummaryColumn,
} from "@/components/reports/unit-summary-table";
import {
  REPORT_PERIODS,
  type ActivityReport,
  type AbsenceReport,
  type FeedbackReport,
  type NotificationsReport,
  type ReportPeriod,
  type ReportTab,
  type ReportView,
  type ScoresReport,
} from "@/server/reports/read";

export interface ReportTabOption {
  value: ReportTab;
  label: string;
  hint: string;
}

function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_LANGUAGE_TAGS[locale]).format(value);
}

function formatPercentage(value: number | null, locale: Locale): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat(LOCALE_LANGUAGE_TAGS[locale], {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value / 100);
}

function formatScore(
  value: number | null,
  locale: Locale,
  t: TranslateFunction,
): string {
  return value === null
    ? "—"
    : t("screens.reports.scoreValue", { value: formatNumber(value, locale) });
}

function formatDecimal(value: number, locale: Locale): string {
  return formatNumber(value, locale);
}

function formatDuration(
  hours: number | null,
  locale: Locale,
  t: TranslateFunction,
): string {
  if (hours === null) return "—";
  if (hours < 1) {
    return t("screens.reports.duration.minutes", {
      count: formatNumber(Math.max(1, Math.round(hours * 60)), locale),
    });
  }
  if (hours < 24) {
    return t("screens.reports.duration.hours", {
      count: formatDecimal(hours, locale),
    });
  }
  return t("screens.reports.duration.days", {
    count: formatDecimal(hours / 24, locale),
  });
}

function notificationChannelLabel(
  key: string,
  t: TranslateFunction,
): string {
  return t(`screens.reports.notifications.channels.${key}`);
}

function notificationEventLabel(key: string, t: TranslateFunction): string {
  return t(`screens.reports.notifications.events.${key}`);
}

function feedbackCategoryLabel(key: string, t: TranslateFunction): string {
  return t(`screens.reports.feedback.categories.${key}`);
}

function reportHref(
  tab: ReportTab,
  period: ReportPeriod,
  unitId?: string,
): string {
  const params = new URLSearchParams({ tab, period });
  if (unitId && tab !== "feedback") params.set("unit", unitId);
  return `/reports?${params.toString()}`;
}

function formatUnitName(name: string, depth: number): ReactNode {
  return (
    <span
      className="block"
      style={{ paddingInlineStart: `${Math.min(depth, 6) * 1.25}rem` }}
    >
      {name}
    </span>
  );
}

function Meaning({ children, t }: { children: ReactNode; t: TranslateFunction }) {
  return (
    <p className="border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
      <span className="font-medium text-ink">{t("screens.reports.meaningTitle")}</span> {children}
    </p>
  );
}

function Breakdown({
  title,
  description,
  items,
  emptyTitle,
  emptyDescription,
  locale,
}: {
  title: string;
  description: string;
  items: { label: string; count: number }[];
  emptyTitle: string;
  emptyDescription: string;
  locale: Locale;
}) {
  const max = Math.max(...items.map((item) => item.count), 0);

  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <CardBody className="flex flex-col gap-4">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between gap-3 text-[length:var(--text-sm)]">
                <span className="min-w-0 truncate text-ink">{item.label}</span>
                <span className="mono shrink-0 text-muted">{formatNumber(item.count, locale)}</span>
              </div>
              <div
                aria-hidden
                className="mt-1 h-1.5 bg-inset"
              >
                <span
                  className="block h-full bg-primary"
                  style={{ width: max === 0 ? "0%" : `${(item.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  );
}

async function ActivityReportView({ data, locale }: { data: ActivityReport; locale: Locale }) {
  const t = await getTranslations(locale);
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label={t("screens.reports.activities.total")} value={formatNumber(data.total, locale)} />
        <Stat label={t("screens.reports.activities.people")} value={formatNumber(data.people, locale)} />
        <Stat label={t("screens.reports.activities.days")} value={formatNumber(data.activityDays, locale)} />
        <Stat
          label={t("screens.reports.activities.approvalRate")}
          value={formatPercentage(data.approvalRate, locale)}
          tone={data.approvalRate !== null && data.approvalRate < 70 ? "correction" : "primary"}
        />
      </StatStrip>

      <Meaning t={t}>{t("screens.reports.activities.approvalMeaning")}</Meaning>

      <Card>
        <CardHeader
          title={t("screens.reports.activities.decisionStatus")}
          description={t("screens.reports.activities.decisionDescription")}
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span className="flex items-center gap-2">
            <Badge tone="success">{t("screens.reports.activities.approved")}</Badge>
            <strong className="mono font-semibold">{formatNumber(data.approved, locale)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="waiting">{t("screens.reports.activities.pending")}</Badge>
            <strong className="mono font-semibold">{formatNumber(data.pending, locale)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="correction">{t("screens.reports.activities.changesRequested")}</Badge>
            <strong className="mono font-semibold">{formatNumber(data.changesRequested, locale)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="danger">{t("screens.reports.activities.rejected")}</Badge>
            <strong className="mono font-semibold">{formatNumber(data.rejected, locale)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone="cancelled">{t("screens.reports.activities.cancelled")}</Badge>
            <strong className="mono font-semibold">{formatNumber(data.cancelled, locale)}</strong>
          </span>
          {data.pendingOlderThanSevenDays > 0 ? (
            <span className="flex items-center gap-2">
              <Badge tone="danger">{t("screens.reports.activities.pendingLong")}</Badge>
              <strong className="mono font-semibold">{formatNumber(data.pendingOlderThanSevenDays, locale)}</strong>
            </span>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("screens.reports.activities.byUnit")}
          description={t("screens.reports.activities.byUnitDescription")}
        />
        {data.units.length === 0 ? (
          <EmptyState
            title={t("screens.reports.activities.noActivities")}
            description={t("screens.reports.activities.noActivitiesDescription")}
          />
        ) : (
          <UnitSummaryTable
            label={t("screens.reports.activities.byUnit")}
            rows={data.units}
            columns={[
              { key: "unit", header: t("screens.reports.table.unit"), className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "activities", header: t("screens.reports.table.activities"), align: "right", className: "mono", render: (unit) => formatNumber(unit.activities, locale) },
              { key: "people", header: t("screens.reports.table.people"), align: "right", className: "mono", render: (unit) => formatNumber(unit.people, locale) },
              { key: "approved", header: t("screens.reports.table.approved"), align: "right", className: "mono", render: (unit) => formatNumber(unit.approved, locale) },
              { key: "pending", header: t("screens.reports.table.pending"), align: "right", className: "mono", render: (unit) => formatNumber(unit.pending, locale) },
              { key: "approvalRate", header: t("screens.reports.table.approvalRate"), align: "right", className: "mono", render: (unit) => formatPercentage(unit.approvalRate, locale) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

async function AbsenceReportView({ data, locale }: { data: AbsenceReport; locale: Locale }) {
  const t = await getTranslations(locale);
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label={t("screens.reports.absence.requests")} value={formatNumber(data.periods, locale)} />
        <Stat label={t("screens.reports.absence.people")} value={formatNumber(data.people, locale)} />
        <Stat label={t("screens.reports.absence.approvedDays")} value={formatNumber(data.approvedDays, locale)} tone="primary" />
        <Stat label={t("screens.reports.absence.pendingDays")} value={formatNumber(data.pendingDays, locale)} tone={data.pendingDays > 0 ? "correction" : "neutral"} />
      </StatStrip>

      <Meaning t={t}>{t("screens.reports.absence.meaning")}</Meaning>

      <Card>
        <CardHeader
          title={t("screens.reports.absence.status")}
          description={t("screens.reports.absence.statusDescription")}
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span className="flex items-center gap-2"><Badge tone="success">{t("screens.reports.activities.approved")}</Badge><strong className="mono">{formatNumber(data.approved, locale)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="waiting">{t("screens.reports.activities.pending")}</Badge><strong className="mono">{formatNumber(data.pending, locale)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="danger">{t("screens.reports.activities.rejected")}</Badge><strong className="mono">{formatNumber(data.rejected, locale)}</strong></span>
          <span className="flex items-center gap-2"><Badge tone="cancelled">{t("screens.reports.activities.cancelled")}</Badge><strong className="mono">{formatNumber(data.cancelled, locale)}</strong></span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("screens.reports.absence.byUnit")}
          description={t("screens.reports.absence.byUnitDescription")}
        />
        {data.units.length === 0 ? (
          <EmptyState title={t("screens.reports.absence.noRecords")} description={t("screens.reports.absence.noRecordsDescription")} />
        ) : (
          <UnitSummaryTable
            label={t("screens.reports.absence.byUnit")}
            rows={data.units}
            columns={[
              { key: "unit", header: t("screens.reports.table.unit"), className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "people", header: t("screens.reports.table.people"), align: "right", className: "mono", render: (unit) => formatNumber(unit.people, locale) },
              { key: "periods", header: t("screens.reports.absence.requestsColumn"), align: "right", className: "mono", render: (unit) => formatNumber(unit.periods, locale) },
              { key: "approvedDays", header: t("screens.reports.table.approvedDays"), align: "right", className: "mono", render: (unit) => formatNumber(unit.approvedDays, locale) },
              { key: "pending", header: t("screens.reports.absence.pendingRequests"), align: "right", className: "mono", render: (unit) => formatNumber(unit.pending, locale) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

async function NotificationsReportView({ data, locale }: { data: NotificationsReport; locale: Locale }) {
  const t = await getTranslations(locale);
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label={t("screens.reports.notifications.total")} value={formatNumber(data.total, locale)} />
        <Stat label={t("screens.reports.notifications.successRate")} value={formatPercentage(data.successRate, locale)} tone={data.successRate !== null && data.successRate < 90 ? "correction" : "primary"} />
        <Stat label={t("screens.reports.notifications.submitted")} value={formatNumber(data.sent, locale)} tone="primary" />
        <Stat label={t("screens.reports.notifications.failed")} value={formatNumber(data.failed, locale)} tone={data.failed > 0 ? "correction" : "neutral"} />
      </StatStrip>

      <Meaning t={t}>{t("screens.reports.notifications.meaning")}</Meaning>

      <div className="grid gap-(--spacing-block) lg:grid-cols-2">
        <Breakdown
          title={t("screens.reports.notifications.byChannel")}
          description={t("screens.reports.notifications.byChannelDescription")}
          items={data.byChannel.map((item) => ({
            label: notificationChannelLabel(item.key, t),
            count: item.count,
          }))}
          emptyTitle={t("screens.reports.noDataTitle")}
          emptyDescription={t("screens.reports.noDataDescription")}
          locale={locale}
        />
        <Breakdown
          title={t("screens.reports.notifications.byEvent")}
          description={t("screens.reports.notifications.byEventDescription")}
          items={data.byEvent.map((item) => ({
            label: notificationEventLabel(item.key, t),
            count: item.count,
          }))}
          emptyTitle={t("screens.reports.noDataTitle")}
          emptyDescription={t("screens.reports.noDataDescription")}
          locale={locale}
        />
      </div>

      <Card>
        <CardHeader
          title={t("screens.reports.notifications.byUnit")}
          description={t("screens.reports.notifications.byUnitDescription")}
        />
        {data.units.length === 0 ? (
          <EmptyState title={t("screens.reports.notifications.noRecords")} description={t("screens.reports.notifications.noRecordsDescription")} />
        ) : (
          <UnitSummaryTable
            label={t("screens.reports.notifications.byUnit")}
            rows={data.units}
            columns={[
              { key: "unit", header: t("screens.reports.table.unit"), className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "total", header: t("screens.reports.table.total"), align: "right", className: "mono", render: (unit) => formatNumber(unit.total, locale) },
              { key: "sent", header: t("screens.reports.table.submitted"), align: "right", className: "mono", render: (unit) => formatNumber(unit.sent, locale) },
              { key: "pending", header: t("screens.reports.table.pending"), align: "right", className: "mono", render: (unit) => formatNumber(unit.pending, locale) },
              { key: "failed", header: t("screens.reports.table.failed"), align: "right", className: "mono", render: (unit) => formatNumber(unit.failed, locale) },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

async function ScoresReportView({ data, locale }: { data: ScoresReport; locale: Locale }) {
  const t = await getTranslations(locale);
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label={t("screens.reports.scores.scorecards")} value={formatNumber(data.periods, locale)} />
        <Stat label={t("screens.reports.scores.people")} value={formatNumber(data.people, locale)} />
        <Stat label={t("screens.reports.scores.average")} value={formatScore(data.averageTotal, locale, t)} tone="primary" />
        <Stat label={t("screens.reports.scores.appreciationPoints")} value={`+${formatNumber(data.appreciationPoints, locale)}`} tone={data.appreciationPoints > 0 ? "primary" : "neutral"} />
      </StatStrip>

      <Meaning t={t}>{t("screens.reports.scores.meaning")}</Meaning>

      <Card>
        <CardHeader
          title={t("screens.reports.scores.sections")}
          description={t("screens.reports.scores.sectionsDescription")}
        />
        <CardBody className="flex flex-wrap gap-x-8 gap-y-3 text-[length:var(--text-sm)]">
          <span>{t("screens.reports.scores.regularity")} <strong className="mono">{formatScore(data.averageRegularity, locale, t)}</strong></span>
          <span>{t("screens.reports.scores.acceptance")} <strong className="mono">{formatScore(data.averageAcceptance, locale, t)}</strong></span>
          <span>{t("screens.reports.scores.approval")} <strong className="mono">{formatScore(data.averageApproval, locale, t)}</strong></span>
          <span>{t("screens.reports.scores.followUp")} <strong className="mono">{formatScore(data.averageFollowUp, locale, t)}</strong></span>
          <span>{t("screens.reports.scores.appreciations")} <strong className="mono">{formatNumber(data.appreciationCount, locale)}</strong></span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("screens.reports.scores.byUnit")}
          description={t("screens.reports.scores.byUnitDescription")}
        />
        {data.units.length === 0 ? (
          <EmptyState title={t("screens.reports.scores.noRecords")} description={t("screens.reports.scores.noRecordsDescription")} />
        ) : (
          <UnitSummaryTable
            label={t("screens.reports.scores.byUnit")}
            rows={data.units}
            columns={[
              { key: "unit", header: t("screens.reports.table.unit"), className: "font-medium", render: (unit) => formatUnitName(unit.name, unit.depth) },
              { key: "periods", header: t("screens.reports.scores.scorecardsColumn"), align: "right", className: "mono", render: (unit) => formatNumber(unit.periods, locale) },
              { key: "people", header: t("screens.reports.table.people"), align: "right", className: "mono", render: (unit) => formatNumber(unit.people, locale) },
              { key: "averageTotal", header: t("screens.reports.scores.averageScore"), align: "right", className: "mono", render: (unit) => formatScore(unit.averageTotal, locale, t) },
              { key: "appreciationCount", header: t("screens.reports.table.appreciations"), align: "right", className: "mono", render: (unit) => formatNumber(unit.appreciationCount, locale) },
              { key: "appreciationPoints", header: t("screens.reports.table.appreciationPoints"), align: "right", className: "mono", render: (unit) => `+${formatNumber(unit.appreciationPoints, locale)}` },
            ] satisfies readonly UnitSummaryColumn<(typeof data.units)[number]>[]}
          />
        )}
      </Card>
    </div>
  );
}

async function FeedbackReportView({ data, locale }: { data: FeedbackReport; locale: Locale }) {
  const t = await getTranslations(locale);
  return (
    <div className="flex flex-col gap-(--spacing-block)">
      <StatStrip>
        <Stat label={t("screens.reports.feedback.total")} value={formatNumber(data.total, locale)} />
        <Stat label={t("screens.reports.feedback.new")} value={formatNumber(data.newCount, locale)} tone={data.newCount > 0 ? "primary" : "neutral"} />
        <Stat label={t("screens.reports.feedback.inReview")} value={formatNumber(data.inReview, locale)} tone={data.inReview > 0 ? "correction" : "neutral"} />
        <Stat label={t("screens.reports.feedback.resolved")} value={formatNumber(data.resolved, locale)} tone="primary" />
      </StatStrip>

      <Meaning t={t}>{t("screens.reports.feedback.meaning")}</Meaning>

      <div className="grid gap-(--spacing-block) lg:grid-cols-2">
        <Breakdown
          title={t("screens.reports.feedback.byType")}
          description={t("screens.reports.feedback.byTypeDescription")}
          items={data.byCategory.map((item) => ({
            label: feedbackCategoryLabel(item.key, t),
            count: item.count,
          }))}
          emptyTitle={t("screens.reports.noDataTitle")}
          emptyDescription={t("screens.reports.noDataDescription")}
          locale={locale}
        />
        <Card>
          <CardHeader
            title={t("screens.reports.feedback.responseTime")}
            description={t("screens.reports.feedback.responseTimeDescription")}
          />
          <CardBody className="grid grid-cols-2 gap-6 sm:max-w-lg">
            <Stat label={t("screens.reports.feedback.firstRead")} value={formatDuration(data.averageFirstReadHours, locale, t)} />
            <Stat label={t("screens.reports.feedback.resolution")} value={formatDuration(data.averageResolutionHours, locale, t)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ReportDataView({ data, locale }: { data: ReportView["data"]; locale: Locale }) {
  switch (data.tab) {
    case "absence":
      return <AbsenceReportView data={data} locale={locale} />;
    case "notifications":
      return <NotificationsReportView data={data} locale={locale} />;
    case "scores":
      return <ScoresReportView data={data} locale={locale} />;
    case "feedback":
      return <FeedbackReportView data={data} locale={locale} />;
    case "activities":
    default:
      return <ActivityReportView data={data} locale={locale} />;
  }
}

async function ReportFilters({
  report,
  period,
  tab,
  locale,
  selectedUnitId,
}: {
  report: ReportView;
  period: ReportPeriod;
  tab: ReportTab;
  locale: Locale;
  selectedUnitId?: string;
}) {
  const t = await getTranslations(locale);
  return (
    <Card className="bg-raised">
      <CardBody>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
            <span className="text-[length:var(--text-sm)] font-medium text-ink">{t("screens.reports.period")}</span>
            <Select name="period" defaultValue={period}>
              {REPORT_PERIODS.map((item) => (
                <option key={item.value} value={item.value}>
                  {t("screens.reports.periods." + item.value)}
                </option>
              ))}
            </Select>
          </label>
          {tab !== "feedback" ? (
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">{t("screens.reports.unitScope")}</span>
              <Select name="unit" defaultValue={selectedUnitId ?? ""}>
                <option value="">{t("screens.reports.rootAndChildren", { unit: report.scope.rootOrgUnitName })}</option>
                {report.scope.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {`${"· ".repeat(Math.min(unit.depth, 6))}${unit.name}`}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" size="sm">{t("screens.reports.apply")}</Button>
          {selectedUnitId || period !== "month" ? (
            <Link href={reportHref(tab, "month")} className="inline-flex h-8 items-center px-2.5 text-[length:var(--text-xs)] text-muted hover:text-ink">
              {t("screens.reports.clear")}
            </Link>
          ) : null}
        </form>
        <p className="mt-3 text-[length:var(--text-xs)] text-muted">
          {t("screens.reports.reportRange")}{" "}
          <span className="font-medium text-ink">
            {t("screens.reports.periods." + report.range.period)}
          </span>
          {tab === "feedback" ? (
            <> · {t("screens.reports.feedbackScope")}</>
          ) : (
            <> · {t("screens.reports.scopePrefix")} <span className="font-medium text-ink">{report.selectedScope.rootOrgUnitName}</span> {t("screens.reports.childUnits")}</>
          )}
        </p>
      </CardBody>
    </Card>
  );
}

export function ReportsView({
  report,
  tabs,
  tab,
  period,
  locale,
  selectedUnitId,
}: {
  report: ReportView;
  tabs: ReportTabOption[];
  tab: ReportTab;
  period: ReportPeriod;
  locale: Locale;
  selectedUnitId?: string;
}) {
  const activeHref = reportHref(tab, period, selectedUnitId);

  return (
    <>
      <AdminTabs
        tabs={tabs.map((item) => ({
          href: reportHref(item.value, period, selectedUnitId),
          label: item.label,
          hint: item.hint,
        }))}
        activeHref={activeHref}
      />

      <ReportFilters
        report={report}
        period={period}
        tab={tab}
        locale={locale}
        selectedUnitId={selectedUnitId}
      />

      <ReportDataView data={report.data} locale={locale} />
    </>
  );
}

export async function ReportPageFrame({
  children,
  report,
}: {
  children: ReactNode;
  report: ReportView;
}) {
  const t = await getTranslations();
  return (
    <Page marker="reports">
      {children}
      <p className="text-[length:var(--text-xs)] text-faint">
        {t("screens.reports.frameNote")}
      </p>
      <span className="sr-only">{report.selectedScope.rootOrgUnitName}</span>
    </Page>
  );
}
