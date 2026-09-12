import type { PrismaClient } from "@prisma/client";

import { listVisibleActivities } from "@/server/authz/activity-repository";
import type { VisibilityDb } from "@/server/authz/visibility";

// Notification visibility filter (audit 21.08.2026, finding 3).
//
// A notification is accurate news at the moment it happens — but may no longer
// be accurate when read or sent. The user might have been transferred, their proxy
// expired, or a decision made by someone else. Showing the title or emailing it
// past that point violates visibility rules (§8, §18.4).
//
// Rule: activity-linked notifications are displayed/sent only if the activity is
// currently visible. Non-activity notifications (password reset, account created,
// job lag) always pass through.

export type VisibleRowsDb = Pick<PrismaClient, "activity"> & VisibilityDb;

/**
 * Returns activity IDs currently visible to this viewer.
 */
export async function getVisibleActivityIds(
  db: VisibleRowsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  activityIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const uniqueIds = [...new Set(activityIds)];
  if (uniqueIds.length === 0) return new Set();

  const rows = await listVisibleActivities(db, viewer, {
    where: { id: { in: uniqueIds } },
    select: { id: true },
  }, undefined, now);

  return new Set(rows.map((row) => row.id));
}

/**
 * Partitions queue rows based on activity visibility.
 *
 * `passed`: can be shown/sent; `dropped`: tied to an activity the recipient can no longer view.
 */
export async function partitionRowsByVisibility<T extends { activityId: string | null }>(
  db: VisibleRowsDb,
  viewer: { id: string; isSystemAdmin: boolean },
  rows: T[],
  now: Date = new Date(),
): Promise<{ passed: T[]; dropped: T[] }> {
  const activityIds = rows
    .map((row) => row.activityId)
    .filter((id): id is string => id !== null);

  if (activityIds.length === 0) {
    return { passed: rows, dropped: [] };
  }

  const visible = await getVisibleActivityIds(db, viewer, activityIds, now);

  const passed: T[] = [];
  const dropped: T[] = [];

  for (const row of rows) {
    if (row.activityId === null || visible.has(row.activityId)) passed.push(row);
    else dropped.push(row);
  }

  return { passed, dropped };
}
