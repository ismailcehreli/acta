import type { Prisma, PrismaClient } from "@prisma/client";

import {
  countVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";



//


//


//


export type UnreadDb = Pick<
  PrismaClient,
  | "activityApprover"
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "$queryRaw"
> & ActivityRepositoryDb;


export function unreadActivityConditions(
  viewerId: string,
): Prisma.ActivityWhereInput[] {
  return [
    { authorId: { not: viewerId } },

    { approvalStatus: { notIn: ["CANCELLED", "REJECTED"] } },
    { readReceipts: { none: { userId: viewerId } } },
  ];
}

export async function countUnreadInScope(
  db: UnreadDb,
  viewer: Viewer,

  precomputedSubordinates?: string[],
): Promise<number> {
  return countVisibleActivities(
    db,
    viewer,
    {
      AND: unreadActivityConditions(viewer.id),
    },
    precomputedSubordinates,
  );
}
