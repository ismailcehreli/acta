"use client";

import Link from "next/link";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import type { DepartmentSummaryRow } from "@/server/dashboard/department-summary";
import type { StatusSlice, TrendSummary } from "@/server/dashboard/charts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatNumber } from "@/shared/format/locale";

import { DistributionBars, type DistributionRow } from "./distribution-bars";
import { TrendChart } from "./trend-chart";


//




//



const STATUS_TONES: Record<
  StatusSlice["status"],
  DistributionRow["tone"]
> = {
  APPROVED: "success",
  PENDING_APPROVAL: "waiting",
  CHANGES_REQUESTED: "correction",
  REJECTED: "danger",
  CANCELLED: "cancelled",
  MANAGER_NOT_FOUND: "danger",
  DRAFT: undefined,
};


const STATUS_FILTER: Partial<Record<StatusSlice["status"], string>> = {
  PENDING_APPROVAL: "approval",
  CHANGES_REQUESTED: "changesRequested",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

export function SummaryCharts({
  trend,
  departments,
  statuses,
  period,
  periodLabel,
}: {
  trend: TrendSummary;
  departments: DepartmentSummaryRow[];
  statuses: StatusSlice[];
  period: string;
  periodLabel: string;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const manyDepartments = departments.length > 1;

  const departmentRows: DistributionRow[] = departments.map((row) => ({
    key: row.orgUnitId,
    label: `${row.depth > 0 ? `${"· ".repeat(row.depth)} ` : ""}${row.name}`,
    count: row.activityCount,
    hint: [
      row.isRollup
        ? t("dashboard.peopleWithChildUnits", {
            count: formatNumber(row.people, locale),
          })
        : t("dashboard.peopleCount", {
            count: formatNumber(row.people, locale),
          }),
      row.pendingApproval > 0
        ? t("dashboard.awaitingApprovalCount", {
            count: formatNumber(row.pendingApproval, locale),
          })
        : null,
      row.participation
        ? t("dashboard.enteredToday", {
            wrote: formatNumber(row.participation.wrote, locale),
            expected: formatNumber(row.participation.expected, locale),
          })
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: "primary" as const,
    // Rollup rows include child units. Linking one to a single-unit feed would
    // hide part of the total, while direct unit rows can be opened safely.
    href: row.isRollup
      ? undefined
      : `/feed?${new URLSearchParams({
          period,
          authorOrgUnitId: row.orgUnitId,
        }).toString()}`,
  }));

  const statusRows: DistributionRow[] = statuses.map((statusSlice) => {
    const filterKey = STATUS_FILTER[statusSlice.status];

    return {
      key: statusSlice.status,
      label: t(`activityStatus.${statusSlice.status}`),
      count: statusSlice.count,
      tone: STATUS_TONES[statusSlice.status],
      href: filterKey
        ? `/feed?${new URLSearchParams({ period, status: filterKey }).toString()}`
        : `/feed?${new URLSearchParams({ period }).toString()}`,
    };
  });

  return (
    <div className="grid gap-(--spacing-block) lg:grid-cols-2">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader
          title={t("dashboard.dailyRecordCount")}
          description={t("dashboard.weekendBars")}
        />
        <CardBody>
          <TrendChart trend={trend} />
        </CardBody>
      </Card>

      {/* A single-department manager does not get a distribution chart: one bar
          at 100% says nothing. The status card then spans the full row. */}
      {manyDepartments ? (
        <Card className="min-w-0" data-test="department-summary">
          <CardHeader
            title={t("dashboard.recordsByDepartment")}
            description={t("dashboard.selectUnitRow", { period: periodLabel })}
          />
          <CardBody>
            <DistributionBars
              rows={departmentRows}
              emptyText={t("dashboard.noDepartmentRecordsInPeriod")}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card className={manyDepartments ? "min-w-0" : "min-w-0 lg:col-span-2"}>
        <CardHeader
          title={t("dashboard.recordStatus")}
          description={t("dashboard.activitiesEnteredDuring", { period: periodLabel })}
        />
        <CardBody>
          <DistributionBars
            rows={statusRows}
            emptyText={t("dashboard.noRecordsInPeriod")}
          />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Short dashboard feed preview; the complete feed is on a separate page.
 *
 * The title is the scope name ("My department", "Entire company"): users need
 * to know whose records these five rows contain.
 */
export function FeedPreview({
  children,
  previewCount,
  href,
  count,
  label,
}: {
  children: React.ReactNode;
  /** Number of records shown in the preview; the description uses this count. */
  previewCount: number;
  href: string;
  count: number;
  label: string;
}) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader
        title={label}
        description={t("dashboard.mostRecentRecords", { count: previewCount })}
        action={
          <Link
            href={href}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            {count > 0
              ? t("dashboard.viewFullFeedCount", { count })
              : t("dashboard.viewFullFeed")}
          </Link>
        }
      />
      {children}
    </Card>
  );
}
