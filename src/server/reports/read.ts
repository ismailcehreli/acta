import {
  visibleReportScope,
  type ReportScope,
} from "@/server/authz/visibility";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";

import { readAbsenceReport } from "./absence";
import { readActivityReport } from "./activities";
import type { ReportDb } from "./db";
import { readFeedbackReport } from "./feedback";
import { readNotificationsReport } from "./notifications";
import { reportPeriodRange, type ReportPeriod } from "./range";
import { narrowReportScope } from "./scope";
import { readScoresReport } from "./scores";
import type { ReportData, ReportTab, ReportView } from "./types";


export async function readReportForScope(
  db: ReportDb,
  scope: ReportScope,
  tab: ReportTab,
  period: ReportPeriod,
  selectedUnitId: string | undefined,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): Promise<ReportView | null> {


  const selectedScope =
    tab === "feedback" ? scope : narrowReportScope(scope, selectedUnitId);
  if (!selectedScope) return null;
  const range = reportPeriodRange(period, now);

  let data: ReportData | null;
  switch (tab) {
    case "absence":
      data = await readAbsenceReport(db, selectedScope, range, locale);
      break;
    case "notifications":
      data = await readNotificationsReport(db, selectedScope, range, locale);
      break;
    case "scores":
      data = await readScoresReport(db, selectedScope, range, locale);
      break;
    case "feedback":
      data = await readFeedbackReport(db, scope.isSystemAdmin, range);
      break;
    case "activities":
    default:
      data = await readActivityReport(db, selectedScope, range, now, locale);
      break;
  }

  if (!data) return null;
  return { range, scope, selectedScope, data };
}


export async function readReport(
  db: ReportDb,
  viewer: { id: string },
  tab: ReportTab,
  period: ReportPeriod,
  selectedUnitId: string | undefined,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): Promise<ReportView | null> {
  const scope = await visibleReportScope(db, viewer.id);
  if (!scope) return null;
  return readReportForScope(db, scope, tab, period, selectedUnitId, now, locale);
}

export type { ReportDb } from "./db";
export { readAbsenceReport } from "./absence";
export { readActivityReport } from "./activities";
export { readFeedbackReport } from "./feedback";
export { readNotificationsReport } from "./notifications";
export { REPORT_PERIODS, reportPeriodRange } from "./range";
export type { ReportPeriod, ReportPeriodRange } from "./range";
export { narrowReportScope } from "./scope";
export { readScoresReport } from "./scores";
export type {
  AbsenceReport,
  ActivityReport,
  FeedbackReport,
  NotificationsReport,
  ReportData,
  ReportTab,
  ReportView,
  ScoreSummary,
  ScoresReport,
} from "./types";
