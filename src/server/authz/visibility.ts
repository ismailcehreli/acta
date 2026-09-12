import { Prisma } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";

import { allDeputyPeriods } from "./deputy";
import type { ActivityApprovalStatus, PrismaClient } from "@prisma/client";

// VISIBILITY LAYER (§8) — this file is the most critical surface of the system.
// Any logic error here would silently leak data without throwing errors. Zero tolerance for leaks (§18.4).
//
// Every read path must pass through here: list, detail, search, attachment download, and reports.
// Any read path constructing its own filter is prohibited.
//
// Core rule (§8.1): A user can see approved activities of users below them in the organization tree.
// Peers in the same unit are not visible to each other; only unit managers can see their unit's activities.
// Users can always see their own activities regardless of approval status.

/**
 * Visibility level:
 * - `none`: Record is not returned or acknowledged.
 * - `metadata`: Only routing metadata (author, date, title). Description and attachments excluded (§8.2 sysadmin exception).
 * - `full`: Full access including content.
 */
export type VisibilityLevel = "none" | "metadata" | "full";

export type VisibilityDb = Pick<
  PrismaClient,
  | "user"
  | "orgUnit"
  | "activity"
  | "activityApprover"
  | "noActivityPeriod"
  | "$queryRaw"
>;

export interface Viewer {
  id: string;
  /** Functional permission; does not grant content access not permitted by hierarchy (§15.1). */
  isSystemAdmin: boolean;
}

export interface ReportScopeUnit {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export interface ReportScopePerson {
  id: string;
  orgUnitId: string;
}

export interface ReportScope {
  rootOrgUnitId: string;
  rootOrgUnitName: string;
  unitIds: string[];
  userIds: string[];
  units: ReportScopeUnit[];
  people: ReportScopePerson[];
  isSystemAdmin: boolean;
  canViewScoreReports: boolean;
}

/**
 * Single scope resolver for aggregated reports.
 * Scope is resolved downward starting from the viewer's organizational unit.
 */
export async function visibleReportScope(
  db: VisibilityDb,
  viewerId: string,
): Promise<ReportScope | null> {
  const actor = await db.user.findUnique({
    where: { id: viewerId },
    select: {
      orgUnitId: true,
      isActive: true,
      isSystemAdmin: true,
      canViewReports: true,
      canViewScoreReports: true,
    },
  });

  if (!actor?.isActive || !actor.canViewReports) return null;

  const units = await db.$queryRaw<ReportScopeUnit[]>`
    WITH RECURSIVE subtree("id", "name", "parentId", depth) AS (
      SELECT "id", "name", "parentId", 0
      FROM "OrgUnit"
      WHERE "id" = ${actor.orgUnitId}
        AND "isActive" = TRUE
      UNION ALL
      SELECT child."id", child."name", child."parentId", subtree.depth + 1
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree."id"
      WHERE child."isActive" = TRUE
    )
    SELECT "id", "name", "parentId", depth
    FROM subtree
    ORDER BY depth, "name"
  `;

  if (units.length === 0) return null;

  const unitIds = units.map((unit) => unit.id);
  const people = await db.user.findMany({
    where: { orgUnitId: { in: unitIds } },
    select: { id: true, orgUnitId: true },
  });

  return {
    rootOrgUnitId: actor.orgUnitId,
    rootOrgUnitName: units.find((unit) => unit.id === actor.orgUnitId)?.name ?? "",
    unitIds,
    userIds: people.map((person) => person.id),
    units,
    people,
    isSystemAdmin: actor.isSystemAdmin,
    canViewScoreReports: actor.canViewScoreReports,
  };
}

export interface ActivityForVisibility {
  id: string;
  authorId: string;
  approvalStatus: ActivityApprovalStatus;
}

/** Statuses visible to upper hierarchy chain (§8.2). */
const CHAIN_VISIBLE_STATUSES: ActivityApprovalStatus[] = ["APPROVED", "CANCELLED"];

/**
 * Statuses visible to active approver (§8.2 matrix).
 */
const APPROVER_VISIBLE_STATUSES: ActivityApprovalStatus[] = [
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "REJECTED",
];

/**
 * Visibility decision for a single activity.
 * Re-uses the list filter (`visibleActivityWhere`) to ensure structural parity.
 */
export async function canViewActivity(
  db: VisibilityDb,
  viewer: Viewer,
  activity: ActivityForVisibility,
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<VisibilityLevel> {
  const scope = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );

  const visible = await db.activity.findFirst({
    where: { AND: [{ id: activity.id }, scope] },
    select: { id: true },
  });

  if (visible) return "full";

  if (viewer.isSystemAdmin && activity.approvalStatus === "MANAGER_NOT_FOUND") {
    return "metadata";
  }

  return "none";
}

/**
 * Returns IDs of users subordinate to the viewer in the organization hierarchy.
 * Only unit managers have subordinates (§4.4).
 */
export async function subordinateUserIds(
  db: VisibilityDb,
  viewerId: string,
): Promise<string[]> {
  const viewer = await db.user.findUnique({
    where: { id: viewerId },
    select: { orgUnitId: true, isUnitManager: true },
  });

  if (!viewer || !viewer.isUnitManager) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${viewer.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT u."id"
    FROM "User" u
    JOIN subtree ON u."orgUnitId" = subtree.id
    WHERE u."id" <> ${viewerId}
  `;

  return rows.map((row) => row.id);
}

/**
 * Visibility clauses arising from deputy periods.
 */
async function deputyClauses(
  db: VisibilityDb,
  viewerId: string,
  now: Date,
): Promise<Prisma.ActivityWhereInput[]> {
  const periods = await allDeputyPeriods(db, viewerId);
  if (periods.length === 0) return [];

  const scopes = new Map<string, string[]>();
  for (const period of periods) {
    if (scopes.has(period.personId)) continue;

    const subordinates = await subordinateUserIds(db, period.personId);
    scopes.set(period.personId, [period.personId, ...subordinates]);
  }

  const clauses: Prisma.ActivityWhereInput[] = periods.map((period) => ({
    authorId: { in: scopes.get(period.personId) ?? [] },
    activityDate: { gte: period.startDate, lte: period.endDate },
    approvalStatus: { in: CHAIN_VISIBLE_STATUSES },
  }));

  clauses.push({
    ...approvalQueueWhere(viewerId, now),
    approvalStatus: { in: APPROVER_VISIBLE_STATUSES },
  });

  return clauses;
}

/**
 * Filter for activities awaiting the viewer's approval (directly or as deputy).
 */
export function approvalQueueWhere(
  viewerId: string,
  now: Date = new Date(),
): Prisma.ActivityWhereInput {
  const today = toDateValue(companyDay(now));

  return {
    eligibleApprovers: {
      some: {
        OR: [
          { userId: viewerId },
          {
            user: {
              noActivityPeriods: {
                some: {
                  deputyId: viewerId,
                  cancelledAt: null,
                  status: "APPROVED",
                  startDate: { lte: today },
                  endDate: { gte: today },
                },
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * Visibility filter for Prisma queries (list, search, count).
 */
export async function visibleActivityWhere(
  db: VisibilityDb,
  viewer: Viewer,
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<Prisma.ActivityWhereInput> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(db, viewer.id));

  const clauses: Prisma.ActivityWhereInput[] = [
    { authorId: viewer.id },
    { approverId: viewer.id },
    {
      eligibleApprovers: { some: { userId: viewer.id } },
      approvalStatus: { in: APPROVER_VISIBLE_STATUSES },
    },
  ];

  clauses.push(...(await deputyClauses(db, viewer.id, now)));

  if (subordinates.length > 0) {
    clauses.push({
      authorId: { in: subordinates },
      approvalStatus: { in: CHAIN_VISIBLE_STATUSES },
    });
  }

  return { OR: clauses };
}

/**
 * SQL representation of the visibility filter for full-text search.
 */
export async function visibleActivitySql(
  db: VisibilityDb,
  viewer: Viewer,
  alias: string,
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<Prisma.Sql> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(db, viewer.id));
  const deputyPeriodsList = await allDeputyPeriods(db, viewer.id);
  const today = toDateValue(companyDay(now));

  if (!/^[a-z][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid table alias: ${alias}`);
  }

  const own = Prisma.sql`${Prisma.raw(`"${alias}"."authorId"`)} = ${viewer.id}`;
  const decided = Prisma.sql`${Prisma.raw(`"${alias}"."approverId"`)} = ${viewer.id}`;

  const approver = Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ActivityApprover" aa
      WHERE aa."activityId" = ${Prisma.raw(`"${alias}"."id"`)}
        AND aa."userId" = ${viewer.id}
    )
    AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${APPROVER_VISIBLE_STATUSES}::text[])
  )`;

  const deputyQueue = Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ActivityApprover" aa
      WHERE aa."activityId" = ${Prisma.raw(`"${alias}"."id"`)}
        AND EXISTS (
          SELECT 1 FROM "NoActivityPeriod" p
          WHERE p."userId" = aa."userId"
            AND p."deputyId" = ${viewer.id}
            AND p."cancelledAt" IS NULL
            AND p."status" = 'APPROVED'
            AND p."startDate" <= ${today}
            AND p."endDate" >= ${today}
        )
    )
    AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${APPROVER_VISIBLE_STATUSES}::text[])
  )`;

  const deputyWindows: Prisma.Sql[] = [];
  const windowScopes = new Map<string, string[]>();

  for (const period of deputyPeriodsList) {
    let scope = windowScopes.get(period.personId);
    if (!scope) {
      scope = [period.personId, ...(await subordinateUserIds(db, period.personId))];
      windowScopes.set(period.personId, scope);
    }

    deputyWindows.push(Prisma.sql`(
      ${Prisma.raw(`"${alias}"."authorId"`)} = ANY(${scope}::text[])
      AND ${Prisma.raw(`"${alias}"."activityDate"`)} >= ${period.startDate}
      AND ${Prisma.raw(`"${alias}"."activityDate"`)} <= ${period.endDate}
      AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${CHAIN_VISIBLE_STATUSES}::text[])
    )`);
  }

  const chain =
    subordinates.length === 0
      ? null
      : Prisma.sql`(
          ${Prisma.raw(`"${alias}"."authorId"`)} = ANY(${subordinates}::text[])
          AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${CHAIN_VISIBLE_STATUSES}::text[])
        )`;

  const parts = [
    own,
    decided,
    approver,
    ...deputyWindows,
    deputyQueue,
    chain,
  ].filter((part): part is Prisma.Sql => part !== null);

  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

/**
 * Intervention queue item for system admins (§8.2).
 */
export interface InterventionItem {
  id: string;
  authorId: string;
  authorName: string;
  activityDate: Date;
  title: string;
}

export type InterventionDb = Pick<PrismaClient, "activity">;

/**
 * MANAGER_NOT_FOUND activities — metadata only for routing interventions.
 */
export async function listInterventionQueue(
  db: InterventionDb,
  viewer: Viewer,
  limit = 100,
): Promise<InterventionItem[]> {
  if (!viewer.isSystemAdmin) return [];

  const rows = await db.activity.findMany({
    where: { approvalStatus: "MANAGER_NOT_FOUND" },
    orderBy: { activityDate: "asc" },
    take: limit,
    select: {
      id: true,
      authorId: true,
      activityDate: true,
      title: true,
      author: { select: { fullName: true } },
    },
  });

  return rows.map(({ author, ...row }) => ({ ...row, authorName: author.fullName }));
}
