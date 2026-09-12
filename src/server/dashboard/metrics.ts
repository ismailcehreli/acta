import type { Prisma, PrismaClient } from "@prisma/client";

import { managedAbsenceEmployeeIds } from "@/server/absence/service";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import {
  countVisibleActivities,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { countableActivityWhere } from "@/server/activities/countable";
import { countManageableFeedback } from "@/server/feedback/service";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";


//




//




export type MetricsDb = ActivityRepositoryDb &
  Pick<
    PrismaClient,
    | "conversation"
    | "followUpItem"
    | "workCalendar"
    | "holiday"
    | "systemSetting"
    | "feedback"
  >;

export interface DashboardMetrics {

  activities: number;

  contributors: number;

  pendingApproval: number;

  correctionRequested: number;

  openQuestions: number;

  openFollowUps: number;

  staleFollowUps: number;

  staleThreshold: number;

  pendingAbsence: number | null;

  newFeedback: number | null;
}

export interface DashboardMetricsOptions {
  canManageAbsences?: boolean;
  canManageFeedback?: boolean;
}


export async function personalDashboardMetrics(
  db: MetricsDb,
  viewer: Viewer,
  period: FeedFilters["period"],
  now: Date,
): Promise<DashboardMetrics> {
  const [scope, calendarSetting, threshold] = await Promise.all([
    visibleActivityWhere(db, viewer, []),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
  ]);

  const start = periodStart(period, now);
  const ownPeriod: Prisma.ActivityWhereInput = {
    AND: [
      scope,
      { authorId: viewer.id },

      countableActivityWhere(),
      ...(start ? [{ activityDate: { gte: start } }] : []),
    ],
  };
  const ownScope: Prisma.ActivityWhereInput = {
    AND: [scope, { authorId: viewer.id }],
  };

  const [activities, correctionRequested, pendingApproval, openQuestions, followUps, contributors] =
    await Promise.all([
      countVisibleActivities(db, viewer, ownPeriod),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, { approvalStatus: "CHANGES_REQUESTED" }],
      }),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, { approvalStatus: "PENDING_APPROVAL" }],
      }),
      countVisibleActivities(db, viewer, {
        AND: [{ authorId: viewer.id }, openQuestionActivityWhere(viewer.id)],
      }),
      db.followUpItem.findMany({
        where: { status: "OPEN", activity: ownScope },
        select: { lastMovedAt: true },
      }),
      listVisibleActivities(db, viewer, {
        where: ownPeriod,
        select: { authorId: true },
        distinct: ["authorId"],
      }),
    ]);

  return {
    activities,
    contributors: contributors.length,
    pendingApproval,
    correctionRequested,
    openQuestions,
    openFollowUps: followUps.length,
    staleFollowUps: await countStaleFollowUps(
      db,
      followUps,
      calendarSetting,
      threshold,
      now,
    ),
    staleThreshold: threshold,
    pendingAbsence: null,
    newFeedback: null,
  };
}

export async function dashboardMetrics(
  db: MetricsDb,
  viewer: Viewer,
  subordinates: string[],
  period: FeedFilters["period"],
  now: Date,
  options: DashboardMetricsOptions = {},
): Promise<DashboardMetrics> {
  const [scope, calendarSetting, threshold, pendingAbsence, newFeedback] = await Promise.all([
    visibleActivityWhere(db, viewer, subordinates),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
    options.canManageAbsences
      ? countPendingManagedAbsences(db, viewer.id, now)
      : Promise.resolve(null),
    options.canManageFeedback
      ? countManageableFeedback(db, viewer.id)
      : Promise.resolve(null),
  ]);

  const start = periodStart(period, now);




  const managedScope: Prisma.ActivityWhereInput = {
    AND: [scope, { authorId: { in: subordinates } }],
  };
  const managedAuthors: Prisma.ActivityWhereInput = {
    authorId: { in: subordinates },
  };
  const periodScope: Prisma.ActivityWhereInput = {
    AND: [
      managedScope,
      countableActivityWhere(),
      ...(start ? [{ activityDate: { gte: start } }] : []),
    ],
  };

  const [activities, pendingApproval, correctionRequested, openQuestions, openItems, authors] =
    await Promise.all([
      countVisibleActivities(db, viewer, periodScope, subordinates),
      countVisibleActivities(
        db,
        viewer,
        { AND: [managedAuthors, { approvalStatus: "PENDING_APPROVAL" }] },
        subordinates,
      ),
      countVisibleActivities(
        db,
        viewer,
        { AND: [managedAuthors, { approvalStatus: "CHANGES_REQUESTED" }] },
        subordinates,
      ),
      countVisibleActivities(
        db,
        viewer,
        {
          AND: [managedAuthors, openQuestionActivityWhere(viewer.id)],
        },
        subordinates,
      ),
      db.followUpItem.findMany({
        where: { status: "OPEN", activity: managedScope },
        select: { lastMovedAt: true },
      }),
      listVisibleActivities(db, viewer, {
        where: periodScope,
        select: { authorId: true },
        distinct: ["authorId"],
      }, subordinates),
    ]);

  return {
    activities,
    contributors: authors.length,
    pendingApproval,
    correctionRequested,
    openQuestions,
    openFollowUps: openItems.length,
    staleFollowUps: await countStaleFollowUps(db, openItems, calendarSetting, threshold, now),
    staleThreshold: threshold,
    pendingAbsence,
    newFeedback,
  };
}


async function countPendingManagedAbsences(
  db: MetricsDb,
  managerId: string,
  now: Date,
): Promise<number> {
  const employeeIds = await managedAbsenceEmployeeIds(db, managerId, now);
  if (employeeIds.length === 0) return 0;

  return db.noActivityPeriod.count({
    where: {
      userId: { in: employeeIds },
      status: "PENDING",
      cancelledAt: null,
    },
  });
}


async function countStaleFollowUps(
  db: MetricsDb,
  items: { lastMovedAt: Date }[],
  calendarSetting: { workingDays: number[] },
  threshold: number,
  now: Date,
): Promise<number> {
  if (items.length === 0) return 0;

  const earliest = items.reduce(
    (min, item) => (item.lastMovedAt < min ? item.lastMovedAt : min),
    items[0].lastMovedAt,
  );
  const calendar = await loadWorkCalendar(db, earliest, now);
  const options = {
    workingDays: calendarSetting.workingDays,
    holidays: calendar.holidays,
  };

  return items.filter(
    (item) => businessDaysBetween(item.lastMovedAt, now, options) >= threshold,
  ).length;
}
