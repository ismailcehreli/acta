

//




import { companyDay } from "@/server/activities/date-rules";


function isoWeekday(day: string): number {
  const date = new Date(`${day}T00:00:00.000Z`);
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export interface BusinessDayOptions {
  /** Working days; defaults to Monday–Friday. */
  workingDays?: number[];
  /** Public holidays in `YYYY-MM-DD` form. */
  holidays?: string[];
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export function isBusinessDay(day: string, options: BusinessDayOptions = {}): boolean {
  const workingDays = options.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = options.holidays ?? [];

  if (holidays.includes(day)) return false;
  return workingDays.includes(isoWeekday(day));
}

/**
 * Counts complete **business days** between two instants. The start day is
 * excluded: "no answer for 3 business days" means the third business day has
 * elapsed.
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  options: BusinessDayOptions = {},
): number {
  const startDay = companyDay(from);
  const endDay = companyDay(to);

  if (endDay <= startDay) return 0;

  let count = 0;
  const cursor = new Date(`${startDay}T00:00:00.000Z`);

  for (let guard = 0; guard < 3650; guard += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.toISOString().slice(0, 10);
    if (day > endDay) break;
    if (isBusinessDay(day, options)) count += 1;
  }

  return count;
}
