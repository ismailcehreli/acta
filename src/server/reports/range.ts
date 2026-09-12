import {
  companyDay,
  nextCompanyDayStart,
  toDateValue,
} from "@/shared/format/date-time";

export type ReportPeriod = "month" | "quarter" | "year" | "all";

export const REPORT_PERIODS: readonly {
  value: ReportPeriod;
}[] = [
  { value: "month" },
  { value: "quarter" },
  { value: "year" },
  { value: "all" },
];

export interface ReportPeriodRange {
  period: ReportPeriod;
  startDay: string | null;
  endDay: string;
  startDate: Date | null;
  endDate: Date;
  endExclusive: Date;
}

function monthStart(year: number, month: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-01`;
}

function dayParts(day: string): [number, number, number] {
  const [year, month, date] = day.split("-").map(Number);
  return [year ?? 0, month ?? 0, date ?? 0];
}

export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function dateDistance(start: string, end: string): number {
  return Math.floor(
    (toDateValue(end).getTime() - toDateValue(start).getTime()) / 86_400_000,
  );
}

export function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

export function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

/** Builds the report day range in company time, including today. */
export function reportPeriodRange(
  period: ReportPeriod,
  now: Date,
): ReportPeriodRange {
  const today = companyDay(now);
  const [year, month] = dayParts(today);

  let startDay: string | null;
  switch (period) {
    case "quarter": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      startDay = monthStart(year, quarterStartMonth);
      break;
    }
    case "year":
      startDay = monthStart(year, 1);
      break;
    case "all":
      startDay = null;
      break;
    case "month":
    default:
      startDay = monthStart(year, month);
      break;
  }

  return {
    period,
    startDay,
    endDay: today,
    startDate: startDay ? toDateValue(startDay) : null,
    endDate: toDateValue(today),
    endExclusive: nextCompanyDayStart(today),
  };
}
