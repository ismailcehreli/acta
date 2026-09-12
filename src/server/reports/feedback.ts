import { companyDayStart } from "@/shared/format/date-time";

import type { ReportDb } from "./db";
import type { ReportPeriodRange } from "./range";
import type { FeedbackReport } from "./types";

function average(total: number, count: number): number | null {
  return count === 0 ? null : Math.round((total / count) * 10) / 10;
}

export async function readFeedbackReport(
  db: ReportDb,
  isSystemAdmin: boolean,
  range: ReportPeriodRange,
): Promise<FeedbackReport | null> {
  if (!isSystemAdmin) return null;
  const rows = await db.feedback.findMany({
    where: {
      archivedAt: null,
      createdAt: {
        ...(range.startDate
          ? { gte: companyDayStart(range.startDay as string) }
          : {}),
        lt: range.endExclusive,
      },
    },
    select: {
      category: true,
      status: true,
      createdAt: true,
      readAt: true,
      resolvedAt: true,
    },
  });
  const categories = new Map<string, number>();
  let firstReadTotal = 0;
  let firstReadCount = 0;
  let resolutionTotal = 0;
  let resolutionCount = 0;
  for (const row of rows) {
    categories.set(row.category, (categories.get(row.category) ?? 0) + 1);
    if (row.readAt) {
      firstReadTotal += row.readAt.getTime() - row.createdAt.getTime();
      firstReadCount += 1;
    }
    if (row.resolvedAt) {
      resolutionTotal += row.resolvedAt.getTime() - row.createdAt.getTime();
      resolutionCount += 1;
    }
  }

  return {
    tab: "feedback",
    total: rows.length,
    newCount: rows.filter((row) => row.status === "NEW").length,
    inReview: rows.filter((row) => row.status === "IN_REVIEW").length,
    resolved: rows.filter((row) => row.status === "RESOLVED").length,
    byCategory: [...categories.entries()]
      .map(([category, count]) => ({ key: category, count }))
      .sort((a, b) => b.count - a.count),
    averageFirstReadHours: average(firstReadTotal / 3_600_000, firstReadCount),
    averageResolutionHours: average(resolutionTotal / 3_600_000, resolutionCount),
  };
}
