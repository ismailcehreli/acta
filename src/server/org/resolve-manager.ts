import type { PrismaClient } from "@prisma/client";




//
// Manager resolution rule (§4.4): walk upward through the organization tree
// until the first active manager is found.




//





//




export type ResolveManagerDb = Pick<PrismaClient, "user" | "orgUnit">;

export type ResolveManagerResult =
  | { found: true; managerId: string; managerOrgUnitId: string }

  | { found: false; reason: "no_manager_in_chain" | "user_not_found" };

export type ResolveManagersResult =
  | { found: true; managerIds: string[]; managerOrgUnitId: string }
  | { found: false; reason: "no_manager_in_chain" | "user_not_found" };


const MAX_LEVELS = 20;

export async function resolveManagers(
  db: ResolveManagerDb,
  userId: string,
): Promise<ResolveManagersResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, orgUnitId: true, isUnitManager: true },
  });

  if (!user) return { found: false, reason: "user_not_found" };



  //



  let unitId: string | null = user.isUnitManager
    ? await parentOf(db, user.orgUnitId)
    : user.orgUnitId;

  for (let level = 0; level < MAX_LEVELS && unitId !== null; level += 1) {
    const managers = await db.user.findMany({
      where: {
        orgUnitId: unitId,
        isUnitManager: true,
        isActive: true,
        // The person themselves cannot be a candidate.
        id: { not: user.id },
      },
      select: { id: true },


      orderBy: { id: "asc" },
    });

    if (managers.length > 0) {
      return {
        found: true,
        managerIds: managers.map((manager) => manager.id),
        managerOrgUnitId: unitId,
      };
    }

    unitId = await parentOf(db, unitId);
  }

  return { found: false, reason: "no_manager_in_chain" };
}


export async function resolveManager(
  db: ResolveManagerDb,
  userId: string,
): Promise<ResolveManagerResult> {
  const result = await resolveManagers(db, userId);
  if (!result.found) return result;

  return {
    found: true,
    managerId: result.managerIds[0],
    managerOrgUnitId: result.managerOrgUnitId,
  };
}

async function parentOf(
  db: ResolveManagerDb,
  orgUnitId: string,
): Promise<string | null> {
  const unit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
    select: { parentId: true },
  });

  return unit?.parentId ?? null;
}
