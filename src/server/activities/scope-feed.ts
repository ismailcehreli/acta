import type { Prisma, PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import { unreadActivityConditions } from "@/server/activities/unread";
import {
  countVisibleActivities,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  subordinateUserIds,
  type Viewer,
} from "@/server/authz/visibility";




//



export type ScopeFeedDb = Pick<PrismaClient, "orgUnit" | "user"> &
  ActivityRepositoryDb;

export interface FeedFilters {

  period?: "today" | "week" | "all";

  authorId?: string;

  authorOrgUnitId?: string;

  targetOrgUnitId?: string;

  status?: "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED";

  unreadOnly?: boolean;

  openQuestions?: boolean;
}

export interface FeedItem {
  id: string;

  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorId: string;
  authorName: string;

  authorAvatarExtension: string | null;

  authorTitle: string | null;
  authorUnitName: string;

  createdAt: Date;
  targetDepartmentNames: string[];

  read: boolean;
}


export function periodStart(
  period: FeedFilters["period"],
  now: Date,
): Date | null {
  if (period === "all") return null;

  const today = toDateValue(companyDay(now));
  if (period === "today") return today;


  const isoWeekday = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday - 1));
  return monday;
}


export interface FeedCursor {
  activityDate: Date;
  createdAt: Date;
  id: string;
}

export interface FeedPage {
  items: FeedItem[];

  nextCursor: FeedCursor | null;
}

export type FeedOrder = "newest" | "oldest";


export interface ScopeSelection {

  subordinates?: string[];

  managedOnly?: boolean;
}

export interface FeedOptions extends ScopeSelection {
  limit?: number;
  cursor?: FeedCursor | null;

  order?: FeedOrder;
}


export function managedAuthorsWhere(
  subordinates: string[],
): Prisma.ActivityWhereInput {
  return { authorId: { in: subordinates } };
}

async function resolveSubordinates(
  db: ScopeFeedDb,
  viewer: Viewer,
  selection: ScopeSelection,
): Promise<string[] | undefined> {
  if (!selection.managedOnly) return selection.subordinates;
  return selection.subordinates ?? subordinateUserIds(db, viewer.id);
}


function filterConditions(
  filters: FeedFilters,
  now: Date,
  viewerId: string,
  managedAuthors?: string[],
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = managedAuthors
    ? [managedAuthorsWhere(managedAuthors)]
    : [];

  const start = periodStart(filters.period, now);
  if (start) conditions.push({ activityDate: { gte: start } });
  if (filters.authorId) conditions.push({ authorId: filters.authorId });
  if (filters.authorOrgUnitId) {
    conditions.push({ authorOrgUnitId: filters.authorOrgUnitId });
  }
  if (filters.targetOrgUnitId) {
    conditions.push({
      targetDepts: { some: { orgUnitId: filters.targetOrgUnitId } },
    });
  }
  if (filters.status) conditions.push({ approvalStatus: filters.status });


  if (filters.openQuestions) {
    conditions.push(openQuestionActivityWhere(viewerId));
  }
  if (filters.unreadOnly) {


    conditions.push(...unreadActivityConditions(viewerId));
  }

  return conditions;
}


function afterCursor(
  cursor: FeedCursor,
  order: FeedOrder,
): Prisma.ActivityWhereInput {
  const ileri = order === "oldest";

  return {
    OR: [
      { activityDate: ileri ? { gt: cursor.activityDate } : { lt: cursor.activityDate } },
      {
        activityDate: cursor.activityDate,
        createdAt: ileri ? { gt: cursor.createdAt } : { lt: cursor.createdAt },
      },
      {
        activityDate: cursor.activityDate,
        createdAt: cursor.createdAt,
        id: ileri ? { gt: cursor.id } : { lt: cursor.id },
      },
    ],
  };
}


export async function countScopeActivities(
  db: ScopeFeedDb,
  viewer: Viewer,
  filters: FeedFilters,
  now: Date,
  selection: ScopeSelection = {},
): Promise<number> {
  const subordinates = await resolveSubordinates(db, viewer, selection);
  return countVisibleActivities(
    db,
    viewer,
    {
      AND: filterConditions(
        filters,
        now,
        viewer.id,
        selection.managedOnly ? subordinates ?? [] : undefined,
      ),
    },
    subordinates,
  );
}

export async function listScopeActivities(
  db: ScopeFeedDb,
  viewer: Viewer,
  filters: FeedFilters,
  now: Date,
  options: FeedOptions = {},
): Promise<FeedPage> {
  const {
    limit = 50,
    cursor = null,
    managedOnly = false,
    order = "newest",
  } = options;
  const subordinates = await resolveSubordinates(db, viewer, options);
  const conditions = [
    ...filterConditions(
      filters,
      now,
      viewer.id,
      managedOnly ? subordinates ?? [] : undefined,
    ),
  ];
  if (cursor) conditions.push(afterCursor(cursor, order));

  const orderBy: Prisma.ActivityOrderByWithRelationInput[] =
    order === "oldest"
      ? [
          { activityDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ]
      : [
          { activityDate: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ];




  const rows = await listVisibleActivities(db, viewer, {
    where: { AND: conditions },
    orderBy,
    take: limit + 1,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      createdAt: true,
      title: true,
      approvalStatus: true,
      authorId: true,
      author: { select: { fullName: true, title: true, avatarExtension: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },


      readReceipts: { where: { userId: viewer.id }, select: { userId: true } },
    },
  }, subordinates);

  const devamiVar = rows.length > limit;
  const page = devamiVar ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      activityNo: row.activityNo,
      activityDate: row.activityDate,
      title: row.title,
      approvalStatus: row.approvalStatus,
      authorId: row.authorId,
      authorName: row.author.fullName,
      authorAvatarExtension: row.author.avatarExtension,
      authorTitle: row.author.title,
      authorUnitName: row.authorOrgUnit.name,
      createdAt: row.createdAt,
      targetDepartmentNames: row.targetDepts.map((t) => t.orgUnit.name),
      read: row.readReceipts.length > 0,
    })),
    nextCursor:
      devamiVar && last
        ? { activityDate: last.activityDate, createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export interface ScopeSummary {
  label: ScopeLabelKey;
  personCount: number;
  hasScope: boolean;
}

export type ScopeLabelKey =
  | "scopes.myScope"
  | "scopes.myDepartment"
  | "scopes.myDepartments"
  | "scopes.entireCompany";


export async function describeScope(
  db: ScopeFeedDb,
  viewer: Viewer,
  precomputed?: string[],
): Promise<ScopeSummary> {
  const subordinates = precomputed ?? (await subordinateUserIds(db, viewer.id));

  if (subordinates.length === 0) {
    return { label: "scopes.myScope", personCount: 0, hasScope: false };
  }

  const units = await db.user.findMany({
    where: { id: { in: subordinates } },
    select: { orgUnitId: true },
    distinct: ["orgUnitId"],
  });

  const rootUnit = await db.orgUnit.findFirst({
    where: { parentId: null },
    select: { id: true },
  });

  const viewerUnit = await db.user.findUnique({
    where: { id: viewer.id },
    select: { orgUnitId: true },
  });

  const coversWholeCompany =
    rootUnit !== null && viewerUnit?.orgUnitId === rootUnit.id;

  const label: ScopeLabelKey = coversWholeCompany
    ? "scopes.entireCompany"
    : units.length > 1
      ? "scopes.myDepartments"
      : "scopes.myDepartment";

  return { label, personCount: subordinates.length, hasScope: true };
}


export async function listScopePeople(
  db: ScopeFeedDb,
  viewer: Viewer,
  precomputed?: string[],
): Promise<{ id: string; fullName: string }[]> {
  const subordinates = precomputed ?? (await subordinateUserIds(db, viewer.id));
  if (subordinates.length === 0) return [];

  return db.user.findMany({
    where: { id: { in: subordinates } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}
