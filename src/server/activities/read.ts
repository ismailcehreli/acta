import type { Prisma, PrismaClient } from "@prisma/client";

import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import {
  countVisibleActivities,
  findVisibleActivity,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type Viewer,
} from "@/server/authz/visibility";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import {
  evaluateActivityEditPermission,
} from "@/server/activities/edit-permission";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";






export type ActivityReadDb = ActivityRepositoryDb &
  Pick<PrismaClient, "systemSetting" | "readReceipt">;

export interface ActivityListItem {
  id: string;

  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  currentRevisionNo: number;

  createdAt: Date;

  updatedAt: Date;
  authorOrgUnitName: string;
  targetDepartmentNames: string[];

  cancellationReason: string | null;

  canEdit: boolean;
}


export interface OwnActivityFilters {
  period?: FeedFilters["period"];

  now: Date;
  status?: FeedFilters["status"];

  openQuestions?: boolean;

  targetOrgUnitId?: string;
}


function ownFilterConditions(
  filters: OwnActivityFilters,
  viewerId: string,
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = [];

  const start = periodStart(filters.period, filters.now);
  if (start) conditions.push({ activityDate: { gte: start } });
  if (filters.status) conditions.push({ approvalStatus: filters.status });
  if (filters.openQuestions) {
    conditions.push(openQuestionActivityWhere(viewerId));
  }
  if (filters.targetOrgUnitId) {
    conditions.push({
      targetDepts: { some: { orgUnitId: filters.targetOrgUnitId } },
    });
  }

  return conditions;
}


export async function listOwnActivities(
  db: ActivityReadDb,
  viewer: Viewer,
  filters: OwnActivityFilters,
  options: { limit?: number; skip?: number } = {},
): Promise<ActivityListItem[]> {
  const { limit = 50, skip = 0 } = options;
  const scope = await visibleActivityWhere(db, viewer);

  const rows = await listVisibleActivities(db, viewer, {
    where: {
      AND: [
        { authorId: viewer.id },
        scope,
        ...ownFilterConditions(filters, viewer.id),
      ],
    },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    skip,
    take: limit,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      approvalStatus: true,
      currentRevisionNo: true,
      createdAt: true,
      updatedAt: true,
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
      cancellation: { select: { reason: true } },
      readReceipts: {
        where: { userId: { not: viewer.id } },
        select: { activityId: true },
        take: 1,
      },
    },
  });

  const windowMinutes = await readNumericSetting(
    db,
    SETTING_KEYS.editWindowMinutes,
  );

  return rows.map(({ authorOrgUnit, targetDepts, cancellation, readReceipts, ...activity }) => {
    const permission = evaluateActivityEditPermission(
      activity,
      filters.now,
      windowMinutes,
      readReceipts.length > 0,
    );

    return {
      ...activity,
      authorOrgUnitName: authorOrgUnit.name,
      targetDepartmentNames: targetDepts.map((target) => target.orgUnit.name),
      cancellationReason: cancellation?.reason ?? null,
      canEdit: permission.allowed,
    };
  });
}


export async function countOwnActivities(
  db: ActivityReadDb,
  viewer: Viewer,
  filters: OwnActivityFilters,
): Promise<number> {
  return countVisibleActivities(db, viewer, {
    AND: [{ authorId: viewer.id }, ...ownFilterConditions(filters, viewer.id)],
  });
}


export async function findOwnActivity(
  db: ActivityReadDb,
  viewer: Viewer,
  activityId: string,
) {
  const scope = await visibleActivityWhere(db, viewer);

  return findVisibleActivity(db, viewer, {
    where: { AND: [{ id: activityId, authorId: viewer.id }, scope] },
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      description: true,
      createdAt: true,
      approvalStatus: true,
      targetDepts: { select: { orgUnitId: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, originalName: true, sizeBytes: true },
      },
    },
  });
}
