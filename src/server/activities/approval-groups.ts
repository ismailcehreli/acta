import type { Prisma, PrismaClient } from "@prisma/client";

import { listAuthorizedActivities } from "@/server/authz/activity-repository";
import { approvalQueueWhere } from "@/server/authz/visibility";

import { companyDay } from "@/server/activities/date-rules";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";

import { approveActivity, type ApprovalDb } from "./approval";


//


//

// The queue is built from the exact records selected by the manager; processing
// a broader query here would approve records the manager never reviewed.

export type ApprovalGroupsDb = ApprovalDb;

export interface GroupedActivity {
  id: string;
  activityNo: number;
  title: string;
  description: string;
  targetDepartmentNames: string[];
}

export interface ApprovalGroup {
  authorId: string;
  authorName: string;
  authorUnitName: string;

  day: string;
  activityDate: Date;
  items: GroupedActivity[];
}


export interface ApprovalGroupFilters {
  period?: FeedFilters["period"];
  authorId?: string;

  authorOrgUnitId?: string;
}


function approvalFilterWhere(
  filters: ApprovalGroupFilters,
  now: Date,
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = [];
  const start = periodStart(filters.period, now);

  if (start) conditions.push({ activityDate: { gte: start } });
  if (filters.authorId) conditions.push({ authorId: filters.authorId });
  if (filters.authorOrgUnitId) {
    conditions.push({ authorOrgUnitId: filters.authorOrgUnitId });
  }

  return conditions;
}


export async function listApprovalGroups(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
  filters: ApprovalGroupFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<ApprovalGroup[]> {
  const groups = await groupQueue(db, approverId, now, filters);
  const { limit, skip = 0 } = options;

  return limit === undefined ? groups : groups.slice(skip, skip + limit);
}


export async function countApprovalGroups(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
  filters: ApprovalGroupFilters = {},
): Promise<number> {
  return (await groupQueue(db, approverId, now, filters)).length;
}

async function groupQueue(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date,
  filters: ApprovalGroupFilters,
): Promise<ApprovalGroup[]> {
  const rows = await listAuthorizedActivities(db, approvalQueueWhere(approverId, now), {







    where: {
      AND: [{ approvalStatus: "PENDING_APPROVAL" }, ...approvalFilterWhere(filters, now)],
    },
    orderBy: [{ activityDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      activityNo: true,
      title: true,
      description: true,
      activityDate: true,
      authorId: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
    },
  });

  const groups = new Map<string, ApprovalGroup>();

  for (const row of rows) {
    const day = companyDay(row.activityDate);
    const key = `${row.authorId}:${day}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        authorId: row.authorId,
        authorName: row.author.fullName,
        authorUnitName: row.authorOrgUnit.name,
        day,
        activityDate: row.activityDate,
        items: [],
      };
      groups.set(key, group);
    }

    group.items.push({
      id: row.id,
      activityNo: row.activityNo,
      title: row.title,
      description: row.description,
      targetDepartmentNames: row.targetDepts.map((target) => target.orgUnit.name),
    });
  }

  return [...groups.values()];
}

export interface BulkApprovalResult {
  approved: number;
  /** Skipped records return their **identities**, not only a count, so the UI can explain them. */
  skipped: { id: string; error: string; message: string }[];
}

/**
 * Approve the records supplied by the caller.
 *
 * **Identities come from the screen, not from a fresh query.** If a new activity
 * arrives after the manager opens the screen, an "approve all" query could approve
 * a record the manager **never read**. The submitted list is therefore processed
 * as-is; newly arrived records appear in the next batch.
 *
 * Records that are no longer eligible or whose status changed are not silently
 * skipped; their count and reasons are returned to the caller.
 */
export async function approveMany(
  db: ApprovalGroupsDb,
  actorId: string,
  activityIds: string[],
  now: Date,
): Promise<BulkApprovalResult> {
  const result: BulkApprovalResult = { approved: 0, skipped: [] };

  for (const id of activityIds) {
    const decision = await approveActivity(db, actorId, id, now);
    if (decision.ok) result.approved += 1;
    else result.skipped.push({ id, error: decision.error, message: decision.message });
  }

  return result;
}
