import { minuteToTime } from "@/shared/schemas/calendar";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface WorkWindowLike {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;
  source: "unit" | "inherited" | "company";
  sourceUnitName: string | null;
}

/** Returns sorted, abbreviated weekday names such as "Mon, Tue, Wed". */
export function formatWorkingDays(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => DAY_NAMES[day - 1] ?? String(day))
    .join(", ");
}

/** Formats a work window such as "07:00–17:00". */
export function formatWorkHours(window: WorkWindowLike): string {
  return `${minuteToTime(window.workStartMinute)}–${minuteToTime(window.workEndMinute)}`;
}

/** Describes where the value was inherited from. */
export function formatWindowSource(window: WorkWindowLike): string {
  if (window.source === "unit") return "the unit's own definition";
  if (window.source === "company") return "company default";
  return window.sourceUnitName
    ? `Inherited from ${window.sourceUnitName}`
    : "Inherited from the parent unit";
}

export function formatHolidayRule(window: WorkWindowLike): string {
  return window.worksOnHolidays
    ? "Works on public holidays"
    : "Does not work on public holidays";
}
