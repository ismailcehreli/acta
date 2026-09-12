"use client";

import type { TrendSummary } from "@/server/dashboard/charts";
import { useLocale, useTranslations } from "@/components/i18n/provider";
import { formatDayShort, formatWeekday, toDateValue } from "@/shared/format/date-time";
import { LOCALE_LANGUAGE_TAGS } from "@/shared/i18n";


//




//





//




const CHART_HEIGHT = 100;
const COLUMN_WIDTH = 100;

function dayLabel(day: string, locale: Parameters<typeof formatDayShort>[1]): string {
  return formatDayShort(toDateValue(day), locale);
}

function weekdayLabel(
  day: string,
  locale: Parameters<typeof formatWeekday>[1],
): string {
  return formatWeekday(toDateValue(day), locale);
}

function isWeekend(day: string): boolean {
  const dayOfWeek = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function TrendChart({ trend }: { trend: TrendSummary }) {
  const locale = useLocale();
  const t = useTranslations();
  const { points, total, workdayAverage, busiest, changePercent, emptyWorkdays } =
    trend;

  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const chartWidth = points.length * COLUMN_WIDTH;
  const averageY = CHART_HEIGHT - (workdayAverage / maxCount) * (CHART_HEIGHT - 12);

  return (
    <div>
      {/* Summary metrics provide the context needed to read the chart. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Metric label={t("dashboard.lastDays", { count: points.length })} value={String(total)} attachment={t("common.records")} />
        <Metric
          label={t("dashboard.comparedWithPreviousPeriod")}
          value={
            changePercent === null
              ? "—"
              : `${changePercent > 0 ? "+" : ""}${changePercent}%`
          }
          attachment={changePercent === null ? t("dashboard.noComparison") : undefined}
          tone={
            changePercent === null
              ? undefined
              : changePercent >= 0
                ? "success"
                : "danger"
          }
        />
        <Metric
          label={t("dashboard.workdayAverage")}
          value={workdayAverage.toLocaleString(LOCALE_LANGUAGE_TAGS[locale])}
          attachment={t("dashboard.recordsPerDay")}
        />
        <Metric
          label={t("dashboard.daysWithoutRecords")}
          value={String(emptyWorkdays)}
          attachment={
            emptyWorkdays === 0
              ? t("dashboard.recordsEveryWorkday")
              : t("dashboard.workdays")
          }
          tone={emptyWorkdays > 0 ? "correction" : undefined}
        />
      </dl>

      {/* Scrolling must stay **inside the card**: the 14-day chart has a readable
          minimum width, but the page itself must not scroll sideways on phones.
          Without `min-w-0`, the grid child locks to the content width. */}
      <div className="mt-5 min-w-0 overflow-x-auto">
        <svg
          aria-hidden
          viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-36 w-full min-w-[520px]"
          role="presentation"
        >
          {points.map((point, i) =>
            isWeekend(point.day) ? (
              // A weekend background distinguishes "no one entered a record"
              // from "this was not a workday".
              <rect
                key={`weekend-${point.day}`}
                x={i * COLUMN_WIDTH}
                y="0"
                width={COLUMN_WIDTH}
                height={CHART_HEIGHT}
                fill="var(--color-inset)"
              />
            ) : null,
          )}

          {points.map((point, i) => {
            const barHeight =
              point.count === 0 ? 0 : (point.count / maxCount) * (CHART_HEIGHT - 12);
            const lastDay = i === points.length - 1;
            const isBusiest = busiest !== null && point.day === busiest.day;

            if (barHeight === 0) return null;

            return (
              <rect
                key={point.day}
                x={i * COLUMN_WIDTH + 20}
                y={CHART_HEIGHT - barHeight}
                width={COLUMN_WIDTH - 40}
                height={barHeight}
                fill={
                  lastDay || isBusiest
                    ? "var(--color-primary)"
                    : "var(--color-line-strong)"
                }
              />
            );
          })}

          {/* The average line makes the height reference explicit. */}
          {workdayAverage > 0 ? (
            <line
              x1="0"
              y1={averageY}
              x2={chartWidth}
              y2={averageY}
              stroke="var(--color-primary)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.55"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* Base rule keeps the columns from appearing to float. */}
          <line
            x1="0"
            y1={CHART_HEIGHT}
            x2={chartWidth}
            y2={CHART_HEIGHT}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Axis labels stay outside the SVG so text does not blur inside a scaled
            viewBox. */}
        <div className="mt-1.5 flex min-w-[520px]">
          {points.map((point, i) => {
            const highlighted =
              i === points.length - 1 || (busiest !== null && point.day === busiest.day);

            return (
              <span
                key={point.day}
                className={`flex flex-1 flex-col items-center gap-0.5 text-[length:var(--text-2xs)] ${
                  highlighted ? "font-semibold text-ink" : "text-faint"
                }`}
              >
                <span className="tabular">{point.count > 0 ? point.count : "·"}</span>
                <span>{dayLabel(point.day, locale)}</span>
              </span>
            );
          })}
        </div>
      </div>

      {busiest && busiest.count > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[length:var(--text-xs)] text-muted">
          {t("dashboard.busiestDay")} {" "}
          <strong className="font-semibold text-ink">
            {dayLabel(busiest.day, locale)} {weekdayLabel(busiest.day, locale)}
          </strong>{" "}
          — {t("dashboard.recordsWithCount", { count: busiest.count })}. {t("dashboard.dashedLineAverage")}
        </p>
      ) : null}

      {/* The same data is available as numbers for assistive technology. */}
      <table className="sr-only">
        <caption>{t("dashboard.recordsByDay")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("common.date")}</th>
            <th scope="col">{t("common.records")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">
                {dayLabel(point.day, locale)} {weekdayLabel(point.day, locale)}
              </th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One metric above the chart: large number, small label, muted suffix. */
function Metric({
  label,
  value,
  attachment,
  tone,
}: {
  label: string;
  value: string;
  attachment?: string;
  tone?: "success" | "danger" | "correction";
}) {
  const textColor =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "correction"
          ? "text-correction"
          : "text-ink";

  return (
    <div>
      <dt className="section-label">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`tabular text-[length:var(--text-xl)] font-semibold ${textColor}`}>
          {value}
        </span>
        {attachment ? (
          <span className="text-[length:var(--text-xs)] text-faint">{attachment}</span>
        ) : null}
      </dd>
    </div>
  );
}
