import { companyDay } from "../src/shared/format/date-time";

// Day calculations for end-to-end tests.
//
// **Why this is separate:** tests used `toISOString().slice(0, 10)`, which is
// the **UTC** day, while the application counts days in the company's local
// timezone (Europe/Istanbul, §16.6). They diverge between midnight and 03:00,
// shifting "yesterday" back by one extra day. With a one-day backdated-entry
// window, tests then sent two days ago and received "date outside the window"
// — a failure that occurred only after midnight (caught on 2026-08-22/23).
//
// The calculation is imported from the application's own module so two
// independently implemented formatters cannot silently diverge.

/** Today's date in the company timezone (YYYY-MM-DD). */
export function today(): string {
  return companyDay(new Date());
}

/** A date `days` away from today in the company timezone. */
export function addDays(days: number): string {
  return companyDay(new Date(Date.now() + days * 86_400_000));
}
