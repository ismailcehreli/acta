import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n/config";

import {
  companyDay,
  formatDay,
  formatInstant,
  formatTime,
} from "./date-time";

/** The two dates shown for an activity and the rule used to display them. */
export interface ActivityDateInput {
  /** The date the activity belongs to (`date` column). */
  activityDate: Date;
  /** The instant when the record was written (`timestamptz`). */
  createdAt: Date;
  /** The instant when the latest revision was written. */
  updatedAt: Date;
  /** The latest revision number; the first record is revision 1. */
  revisionNo: number;
}

export interface ActivityDateLabels {
  saved: string;
  lastEdited: string;
}

const DEFAULT_LABELS: ActivityDateLabels = {
  saved: "Saved",
  lastEdited: "Last edited",
};

export interface ActivityDates {
  /** The main activity date. */
  main: string;
  /** The saved-at line. */
  created: string;
  /** The latest revision line, or null for the first revision. */
  revised: string | null;
}

export function describeActivityDates(
  input: ActivityDateInput,
  locale: Locale = DEFAULT_LOCALE,
  labels: ActivityDateLabels = DEFAULT_LABELS,
): ActivityDates {
  // Compare the activity date with the company-local date of creation. A
  // retroactive record may therefore need the full timestamp displayed.
  const createdDay = companyDay(input.createdAt);
  const activityDay = input.activityDate.toISOString().slice(0, 10);

  const created =
    createdDay === activityDay
      ? `${labels.saved}: ${formatTime(input.createdAt, locale)}`
      : `${labels.saved}: ${formatInstant(input.createdAt, locale)}`;

  const revised =
    input.revisionNo > 1
      ? `${labels.lastEdited}: ${formatInstant(input.updatedAt, locale)} (rev. ${input.revisionNo})`
      : null;

  return { main: formatDay(input.activityDate, locale), created, revised };
}
