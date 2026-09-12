import type { PrismaClient } from "@prisma/client";

// Departments that may be selected as activity targets (§5.3).
//







export type TargetOptionsDb = Pick<PrismaClient, "orgUnit">;

export interface TargetOption {
  id: string;
  name: string;

  own: boolean;
}

export async function listTargetDepartments(
  db: TargetOptionsDb,
  viewerOrgUnitId: string,
): Promise<TargetOption[]> {
  const units = await db.orgUnit.findMany({
    where: { isActive: true },
    select: { id: true, name: true, parentId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const childrenOf = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    const siblings = childrenOf.get(unit.parentId) ?? [];
    siblings.push(unit.id);
    childrenOf.set(unit.parentId, siblings);
  }


  const own = new Set<string>();
  const queue = [viewerOrgUnitId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (own.has(current)) continue;
    own.add(current);
    queue.push(...(childrenOf.get(current) ?? []));
  }

  const options = units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    own: own.has(unit.id),
  }));

  return [
    ...options.filter((option) => option.own),
    ...options.filter((option) => !option.own),
  ];
}
