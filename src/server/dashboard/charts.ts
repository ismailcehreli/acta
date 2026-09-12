import type { PrismaClient } from "@prisma/client";

import { countableActivityWhere } from "@/server/activities/countable";
import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { managedAuthorsWhere } from "@/server/activities/scope-feed";
import {
  groupVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  type Viewer,
} from "@/server/authz/visibility";
import { isBusinessDay } from "@/server/calendar/business-days";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";


//



//



export type ChartsDb = ActivityRepositoryDb &
  Pick<PrismaClient, "orgUnit" | "workCalendar" | "holiday">;

export interface TrendPoint {

  day: string;
  count: number;
}

export interface TrendSummary {
  points: TrendPoint[];

  total: number;

  workdayAverage: number;

  busiest: TrendPoint | null;

  changePercent: number | null;

  emptyWorkdays: number;
}

export interface StatusSlice {
  status: "APPROVED" | "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED" | "MANAGER_NOT_FOUND" | "DRAFT";
  count: number;
}

export interface DashboardChartOptions {

  managedOnly?: boolean;
}


export async function activityTrend(
  db: ChartsDb,
  viewer: Viewer,
  subordinates: string[],
  days: number,
  now: Date,
  options: DashboardChartOptions = {},
): Promise<TrendSummary> {



  const today = companyDay(now);
  const allDays: string[] = [];
  const cursor = new Date(`${today}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (days * 2 - 1));

  for (let i = 0; i < days * 2; i += 1) {
    allDays.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const rows = (await groupVisibleActivities(db, viewer, {
    by: ["activityDate"],
    where: {
      AND: [
        ...(options.managedOnly ? [managedAuthorsWhere(subordinates)] : []),
        // The trend measures "how much work was done"; cancelled and rejected
        // records do not count (decision 03.09.2026). The status distribution
        // intentionally counts every state because states are its subject.
        countableActivityWhere(),
        { activityDate: { gte: toDateValue(allDays[0]) } },
        { activityDate: { lte: toDateValue(allDays[allDays.length - 1]) } },
      ],
    },
    _count: { _all: true },
  }, subordinates)) as { activityDate: Date; _count: { _all: number } }[];

  const counts = new Map(
    rows.map((row) => [
      row.activityDate.toISOString().slice(0, 10),
      row._count._all,
    ]),
  );

  const countForDay = (day: string) => counts.get(day) ?? 0;
  const previousDays = allDays.slice(0, days);
  const periodDays = allDays.slice(days);

  const points: TrendPoint[] = periodDays.map((day) => ({ day, count: countForDay(day) }));
  const total = points.reduce((acc, point) => acc + point.count, 0);
  const previous = previousDays.reduce((acc, day) => acc + countForDay(day), 0);

  // Read the calendar from the company's own definition; do not assume a fixed
  // Saturday/Sunday weekend.
  const calendar = await loadWorkCalendar(db, toDateValue(allDays[0]), now);
  const workDays = points.filter((point) =>
    isBusinessDay(point.day, {
      workingDays: calendar.workingDays,
      holidays: calendar.holidays,
    }),
  );

  return {
    points,
    total,
    workdayAverage:
      workDays.length === 0
        ? 0
        : Math.round(
            (workDays.reduce((acc, point) => acc + point.count, 0) /
              workDays.length) *
              10,
          ) / 10,
    busiest:
      total === 0
        ? null
        : points.reduce((currentBusiest, point) =>
            point.count >= currentBusiest.count ? point : currentBusiest,
          ),
    changePercent:
      previous === 0 ? null : Math.round(((total - previous) / previous) * 100),
    emptyWorkdays: workDays.filter((nokta) => nokta.count === 0).length,
  };
}

/**
 * Distribution of in-scope records by approval status. The period filter is
 * applied so "what happened this week" is not mixed with last month's records.
 */
export async function statusDistribution(
  db: ChartsDb,
  viewer: Viewer,
  subordinates: string[],
  since: Date | null,
  options: DashboardChartOptions = {},
): Promise<StatusSlice[]> {
  const rows = (await groupVisibleActivities(db, viewer, {
    by: ["approvalStatus"],
    where: {
      AND: [
        ...(options.managedOnly ? [managedAuthorsWhere(subordinates)] : []),
        ...(since ? [{ activityDate: { gte: since } }] : []),
      ],
    },
    _count: { _all: true },
  }, subordinates)) as { approvalStatus: string; _count: { _all: number } }[];

  return rows
    .map((row) => ({
      status: row.approvalStatus as StatusSlice["status"],
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}
