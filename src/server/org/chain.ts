import type { PrismaClient } from "@prisma/client";

import { resolveManagers } from "./resolve-manager";




//






export type ChainDb = Pick<PrismaClient, "user" | "orgUnit">;


const MAX_LEVELS = 20;


export async function managementChain(
  db: ChainDb,
  personId: string,
): Promise<string[]> {
  const visited = new Set<string>([personId]);
  const chain: string[] = [];

  let level: string[] = [personId];

  for (let depth = 0; depth < MAX_LEVELS && level.length > 0; depth += 1) {
    const next: string[] = [];

    for (const currentPersonId of level) {
      const managers = await resolveManagers(db, currentPersonId);
      if (!managers.found) continue;

      for (const parentId of managers.managerIds) {
        if (visited.has(parentId)) continue;

        visited.add(parentId);
        chain.push(parentId);
        next.push(parentId);
      }
    }

    level = next;
  }

  return chain;
}


export async function isInManagementChain(
  db: ChainDb,
  personId: string,
  candidateId: string,
): Promise<boolean> {
  if (personId === candidateId) return false;

  const visited = new Set<string>([personId]);
  let level: string[] = [personId];

  for (let depth = 0; depth < MAX_LEVELS && level.length > 0; depth += 1) {
    const next: string[] = [];

    for (const currentPersonId of level) {
      const managers = await resolveManagers(db, currentPersonId);
      if (!managers.found) continue;

      for (const parentId of managers.managerIds) {
        if (parentId === candidateId) return true;
        if (visited.has(parentId)) continue;

        visited.add(parentId);
        next.push(parentId);
      }
    }

    level = next;
  }

  return false;
}
