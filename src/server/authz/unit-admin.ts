import type { PrismaClient } from "@prisma/client";


//




//




//

//







export type UnitAdminDb = Pick<PrismaClient, "user" | "orgUnit" | "$queryRaw">;


export async function manageableUnitIds(
  db: UnitAdminDb,
  actorId: string,
): Promise<string[]> {
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { orgUnitId: true, isUnitManager: true, isSystemAdmin: true, isActive: true },
  });

  if (!actor || !actor.isActive) return [];

  if (actor.isSystemAdmin) {
    const allUnits = await db.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return allUnits.map((unit) => unit.id);
  }

  if (!actor.isUnitManager) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${actor.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT id FROM subtree
  `;

  return rows.map((row) => row.id);
}

/**
 * Can this person perform personnel operations on the target user?
 *
 * The decision lives in one place: screens and server actions both use it.
 * Hiding a screen is not security; the write path calls this function at its
 * boundary.
 */
export async function canManageUser(
  db: UnitAdminDb,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  // An account cannot be managed through this path by its own owner (boundary 3).
  if (actorId === targetId) return false;

  const [actor, target] = await Promise.all([
    db.user.findUnique({
      where: { id: actorId },
      select: { isSystemAdmin: true, isActive: true },
    }),
    db.user.findUnique({
      where: { id: targetId },
      select: { orgUnitId: true, isSystemAdmin: true, isRoot: true },
    }),
  ]);

  if (!actor || !actor.isActive || !target) return false;
  // The root account is protected from everyone, including administrators. Its
  // operational options use a separate, narrow self-update path.
  if (target.isRoot) return false;
  if (actor.isSystemAdmin) return true;

  // Only a system administrator can manage another system administrator
  // account (boundary 2).
  if (target.isSystemAdmin) return false;

  const manageableUnits = await manageableUnitIds(db, actorId);
  return manageableUnits.includes(target.orgUnitId);
}
