import type { Prisma, PrismaClient } from "@prisma/client";

import {
  visibleActivitySql,
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "./visibility";


export type ActivityRepositoryDb = Pick<PrismaClient, "activity" | "$queryRaw"> &
  VisibilityDb;


export async function queryVisibleActivities<T>(
  db: ActivityRepositoryDb,
  viewer: Viewer,
  build: (scope: Prisma.Sql) => Prisma.Sql,
  precomputedSubordinates?: string[],
  now?: Date,
): Promise<T[]> {
  const scope = await visibleActivitySql(
    db,
    viewer,
    "a",
    precomputedSubordinates,
    now,
  );
  return db.$queryRaw<T[]>(build(scope));
}

export async function listVisibleActivities<
  T extends Prisma.ActivityFindManyArgs,
>(
  db: ActivityRepositoryDb,
  viewer: Viewer,
  args: T,
  precomputedSubordinates?: string[],
  now?: Date,
): Promise<Prisma.ActivityGetPayload<T>[]> {
  const scope = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );
  return db.activity.findMany({
    ...args,
    where: { AND: [scope, args.where ?? {}] },
  }) as Promise<Prisma.ActivityGetPayload<T>[]>;
}

export async function countVisibleActivities(
  db: ActivityRepositoryDb,
  viewer: Viewer,
  where: Prisma.ActivityWhereInput = {},
  precomputedSubordinates?: string[],
  now?: Date,
): Promise<number> {
  const scope = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );
  return db.activity.count({ where: { AND: [scope, where] } });
}

export async function groupVisibleActivities<T extends Prisma.ActivityGroupByArgs>(
  db: ActivityRepositoryDb,
  viewer: Viewer,
  args: T,
  precomputedSubordinates?: string[],
  now?: Date,
): Promise<unknown[]> {
  const scope = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );
  return db.activity.groupBy({
    ...args,
    where: { AND: [scope, args.where ?? {}] },
  } as Parameters<PrismaClient["activity"]["groupBy"]>[0]) as unknown as unknown[];
}


export async function listActivitiesByAuthors<
  T extends Prisma.ActivityFindManyArgs,
>(
  db: Pick<PrismaClient, "activity">,
  authorIds: string[],
  args: T,
): Promise<Prisma.ActivityGetPayload<T>[]> {
  return db.activity.findMany({
    ...args,
    where: { AND: [{ authorId: { in: authorIds } }, args.where ?? {}] },
  }) as Promise<Prisma.ActivityGetPayload<T>[]>;
}


export async function listAuthorizedActivities<
  T extends Prisma.ActivityFindManyArgs,
>(
  db: Pick<PrismaClient, "activity">,
  authorizationWhere: Prisma.ActivityWhereInput,
  args: T,
): Promise<Prisma.ActivityGetPayload<T>[]> {
  return db.activity.findMany({
    ...args,
    where: { AND: [authorizationWhere, args.where ?? {}] },
  }) as Promise<Prisma.ActivityGetPayload<T>[]>;
}

export async function findVisibleActivity<T extends Prisma.ActivityFindFirstArgs>(
  db: ActivityRepositoryDb,
  viewer: Viewer,
  args: T,
  precomputedSubordinates?: string[],
  now?: Date,
): Promise<Prisma.ActivityGetPayload<T> | null> {
  const scope = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );
  return db.activity.findFirst({
    ...args,
    where: { AND: [scope, args.where ?? {}] },
  }) as Promise<Prisma.ActivityGetPayload<T> | null>;
}

export async function findActivityForAuthor<T extends Prisma.ActivityFindFirstArgs>(
  db: Pick<PrismaClient, "activity">,
  authorId: string,
  args: T,
): Promise<Prisma.ActivityGetPayload<T> | null> {
  return db.activity.findFirst({
    ...args,
    where: { AND: [{ authorId }, args.where ?? {}] },
  }) as Promise<Prisma.ActivityGetPayload<T> | null>;
}

export async function findVisibleAttachment(
  db: ActivityRepositoryDb & Pick<PrismaClient, "attachment">,
  viewer: Viewer,
  attachmentId: string,
) {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      originalName: true,
      mimeType: true,
      storagePath: true,
      sha256: true,
      sizeBytes: true,
      activity: { select: { id: true } },
    },
  });
  if (!attachment) return null;

  const activity = await findVisibleActivity(db, viewer, {
    where: { id: attachment.activity.id },
    select: { id: true },
  });
  return activity ? attachment : null;
}

export async function listVisibleAttachments(
  db: ActivityRepositoryDb & Pick<PrismaClient, "attachment">,
  viewer: Viewer,
  activityId: string,
) {
  const activity = await findVisibleActivity(db, viewer, {
    where: { id: activityId },
    select: { id: true },
  });
  if (!activity) return [];

  return db.attachment.findMany({
    where: { activityId },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true, sizeBytes: true, mimeType: true },
  });
}


export function activityMaintenanceReader(db: Pick<PrismaClient, "activity">) {
  return db.activity;
}

export function attachmentMaintenanceReader(
  db: Pick<PrismaClient, "attachment">,
) {
  return db.attachment;
}


export async function lockActivitiesForMaintenance(
  db: Pick<PrismaClient, "$queryRaw">,
  activityIds: string[],
): Promise<void> {
  if (activityIds.length === 0) return;
  await db.$queryRaw`
    SELECT "id" FROM "Activity"
    WHERE "id" = ANY(${activityIds}::text[])
    FOR UPDATE
  `;
}

/** Single-record mutation paths use the same activity-row lock boundary. */
export async function lockActivityForMaintenance(
  db: Pick<PrismaClient, "$executeRaw">,
  activityId: string,
): Promise<void> {
  await db.$executeRaw`
    SELECT "id" FROM "Activity" WHERE "id" = ${activityId} FOR UPDATE
  `;
}
