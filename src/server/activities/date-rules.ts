

//





export {
  COMPANY_TIME_ZONE,
  companyDay,
  toDateValue,
} from "@/shared/format/date-time";

import { companyDay, toDateValue } from "@/shared/format/date-time";

function daysBetween(earlier: string, later: string): number {
  const diff = toDateValue(later).getTime() - toDateValue(earlier).getTime();
  return Math.round(diff / 86_400_000);
}

export type ActivityDateProblem = "future" | "too_old";


export function checkActivityDate(
  activityDay: string,
  now: Date,
  retroactiveDays: number,
): ActivityDateProblem | null {
  const today = companyDay(now);
  const distance = daysBetween(activityDay, today);

  if (distance < 0) return "future";
  if (distance > retroactiveDays) return "too_old";

  return null;
}
