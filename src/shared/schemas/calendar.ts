import { z } from "zod";

import { isCalendarDay } from "./iso-date";

// Work-calendar and holiday input (§12.1). The calendar has one company-wide
// definition; shifts and person-specific calendars are not part of this model.

/** ISO weekday number: 1 = Monday … 7 = Sunday. */
export const isoWeekdaySchema = z.coerce.number().int().min(1).max(7);

export const workCalendarSchema = z
  .object({
    workingDays: z
      .array(isoWeekdaySchema)
      .min(1, "Select at least one working day")
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: "A working day cannot be selected more than once",
      }),
    // Minutes since midnight in the company time zone (Europe/Istanbul).
    workStartMinute: z.coerce.number().int().min(0).max(24 * 60 - 1),
    workEndMinute: z.coerce.number().int().min(1).max(24 * 60),
  })
  .refine((value) => value.workEndMinute > value.workStartMinute, {
    message: "Workday end must be after workday start",
    path: ["workEndMinute"],
  });

export const holidayDateSchema = z
  .string()
  .refine(isCalendarDay, "Choose a date in DD.MM.YYYY format");

export const holidaySchema = z.object({
  date: holidayDateSchema,
  description: z
    .string()
    .trim()
    .min(1, "Holiday description is required")
    .max(150, "Description must be 150 characters or fewer"),
});

export type WorkCalendarInput = z.infer<typeof workCalendarSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;

/** Formats a minute value as `HH:MM`. */
export function minuteToTime(minute: number): string {
  const hour = Math.floor(minute / 60);
  const remainder = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/** Converts an `HH:MM` value to minutes since midnight. */
export function timeToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;

  return hour * 60 + minute;
}

export const WEEKDAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};
