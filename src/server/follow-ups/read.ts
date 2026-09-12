import type { PrismaClient } from "@prisma/client";

import { businessDaysBetween } from "@/server/calendar/business-days";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { visibleActivityWhere, type Viewer, type VisibilityDb } from "@/server/authz/visibility";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Follow-up item lists (§11.2).
//



//



export type FollowUpReadDb = VisibilityDb &
  Pick<PrismaClient, "followUpItem" | "workCalendar" | "holiday" | "systemSetting">;

export interface FollowUpView {
  id: string;
  activityId: string;
  activityNo: number;
  activityTitle: string;
  ownerName: string;
  ownerId: string;

  ownerAvatarExtension: string | null;
  nextStep: string | null;
  reviewDate: Date | null;
  openedAt: Date;
  lastMovedAt: Date;

  idleBusinessDays: number;

  stale: boolean;

  mine: boolean;

  reviewOverdue: boolean;
}


export interface FollowUpFilters {

  status?: "OPEN" | "CLOSED";
  ownerId?: string;

  staleOnly?: boolean;
  period?: FeedFilters["period"];
}

export interface FollowUpPage {
  items: FollowUpView[];

  total: number;
  staleThreshold: number;
}


export async function listFollowUps(
  db: FollowUpReadDb,
  viewer: Viewer,
  now: Date,
  filters: FollowUpFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<FollowUpPage> {
  const [scope, calendarSettings, threshold] = await Promise.all([
    visibleActivityWhere(db, viewer),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
  ]);





  const start = periodStart(filters.period ?? "all", now);

  const rows = await db.followUpItem.findMany({


    where: {
      status: filters.status ?? "OPEN",
      activity: scope,
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(start ? { openedAt: { gte: start } } : {}),
    },
    orderBy: { lastMovedAt: "asc" },
    select: {
      id: true,
      activityId: true,
      ownerId: true,
      nextStep: true,
      reviewDate: true,
      openedAt: true,
      lastMovedAt: true,
      owner: { select: { fullName: true, avatarExtension: true } },
      activity: { select: { activityNo: true, title: true } },
    },
  });

  if (rows.length === 0) return { items: [], total: 0, staleThreshold: threshold };

  const earliest = rows.reduce(
    (min, row) => (row.lastMovedAt < min ? row.lastMovedAt : min),
    rows[0].lastMovedAt,
  );
  const calendar = await loadWorkCalendar(db, earliest, now);
  const dayOptions = {
    workingDays: calendarSettings.workingDays,
    holidays: calendar.holidays,
  };

  let views: FollowUpView[] = rows.map((row) => {
    const idle = businessDaysBetween(row.lastMovedAt, now, dayOptions);

    return {
      id: row.id,
      activityId: row.activityId,
      activityNo: row.activity.activityNo,
      activityTitle: row.activity.title,
      ownerId: row.ownerId,
      ownerName: row.owner.fullName,
      ownerAvatarExtension: row.owner.avatarExtension,
      nextStep: row.nextStep,
      reviewDate: row.reviewDate,
      openedAt: row.openedAt,
      lastMovedAt: row.lastMovedAt,
      idleBusinessDays: idle,
      stale: idle >= threshold,
      mine: row.ownerId === viewer.id,
      reviewOverdue:
        row.reviewDate !== null && row.reviewDate.getTime() < now.getTime(),
    };
  });

  if (filters.staleOnly) views = views.filter((item) => item.stale);



  views.sort((a, b) => b.idleBusinessDays - a.idleBusinessDays);

  const { limit, skip = 0 } = options;

  return {
    items: limit === undefined ? views : views.slice(skip, skip + limit),
    total: views.length,
    staleThreshold: threshold,
  };
}


export async function findLatestClosedFollowUp(
  db: Pick<PrismaClient, "followUpItem">,
  activityId: string,
) {
  return db.followUpItem.findFirst({
    where: { activityId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    select: {
      id: true,
      ownerId: true,
      openedById: true,
      closedAt: true,
      closingNote: true,
      closedBy: { select: { fullName: true } },
    },
  });
}


export async function findOpenFollowUp(
  db: Pick<PrismaClient, "followUpItem">,
  activityId: string,
) {
  return db.followUpItem.findFirst({
    where: { activityId, status: "OPEN" },
    select: {
      id: true,
      ownerId: true,
      openedById: true,
      nextStep: true,
      reviewDate: true,
      openedAt: true,
      lastMovedAt: true,
      owner: { select: { fullName: true, avatarExtension: true } },
      openedBy: { select: { fullName: true } },
    },
  });
}
