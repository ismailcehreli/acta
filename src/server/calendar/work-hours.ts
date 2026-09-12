import { companyDay } from "@/server/activities/date-rules";
import { companyMinuteOfDay } from "@/shared/format/date-time";
import { isBusinessDay } from "@/server/calendar/business-days";
import type { CompanyWorkCalendar } from "@/server/calendar/work-calendar";



//
// The company timezone is Europe/Istanbul (§16.6); all day and time calculations
// use it.




export { companyMinuteOfDay } from "@/shared/format/date-time";

export interface WorkDayState {

  isWorkingDay: boolean;

  afterWorkEnd: boolean;

  day: string;
}

export function describeWorkDay(
  now: Date,
  calendar: CompanyWorkCalendar,
  workEndMinute: number,
): WorkDayState {
  const day = companyDay(now);

  return {
    day,
    isWorkingDay: isBusinessDay(day, {
      workingDays: calendar.workingDays,
      holidays: calendar.holidays,
    }),
    afterWorkEnd: companyMinuteOfDay(now) >= workEndMinute,
  };
}


export function shouldRemindForMissingActivity(state: WorkDayState): boolean {
  return state.isWorkingDay && state.afterWorkEnd;
}
