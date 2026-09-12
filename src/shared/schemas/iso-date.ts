import { z } from "zod";

// Calendar day (`YYYY-MM-DD`) — it must be a real calendar date.
//
// A regular expression alone accepts values such as `2026-02-31`, which the
// Date constructor silently normalizes. The server must validate the value
// independently because requests can be crafted without the client.
//
// Validation parses and writes the value back; equality with the input is the
// reliable proof that normalization did not change the calendar day.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Shared date schema used by every schema with a calendar date. */
export function isoDaySchema(message = "Choose a date in DD.MM.YYYY format") {
  return z.string().refine(isCalendarDay, message);
}
