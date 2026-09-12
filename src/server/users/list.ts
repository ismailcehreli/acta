import type { Prisma, PrismaClient } from "@prisma/client";






export type ListUsersDb = Pick<PrismaClient, "user">;

export interface ManagedUser {
  id: string;
  fullName: string;

  title: string | null;
  email: string;
  orgUnitId: string;
  orgUnitName: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  isRoot: boolean;
  canViewReports: boolean;
  canViewScoreReports: boolean;

  writesActivities: boolean;

  avatarExtension: string | null;

  isScored: boolean;

  canAppreciate: boolean;

  lastLoginAt: Date | null;
  isActive: boolean;
}


export interface UserListFilters {

  orgUnitIds?: string[];
  orgUnitId?: string;
  isActive?: boolean;
  role?: "unitManager" | "systemAdmin";

  query?: string;
}


function userWhere(filters: UserListFilters): Prisma.UserWhereInput {
  const search = filters.query?.trim();
  const conditions: Prisma.UserWhereInput[] = [];

  if (filters.orgUnitIds) conditions.push({ orgUnitId: { in: filters.orgUnitIds } });
  if (filters.orgUnitId) conditions.push({ orgUnitId: filters.orgUnitId });
  if (filters.isActive !== undefined) conditions.push({ isActive: filters.isActive });
  if (filters.role === "unitManager") conditions.push({ isUnitManager: true });
  if (filters.role === "systemAdmin") conditions.push({ isSystemAdmin: true });
  if (search) {
    conditions.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  return conditions.length === 0 ? {} : { AND: conditions };
}

export async function listUsers(
  db: ListUsersDb,
  filters: UserListFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<ManagedUser[]> {
  const users = await db.user.findMany({
    where: userWhere(filters),
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      orgUnitId: true,
      isUnitManager: true,
      isSystemAdmin: true,
      isRoot: true,
      canViewReports: true,
      canViewScoreReports: true,
      writesActivities: true,
      isActive: true,
      avatarExtension: true,
      isScored: true,
      canAppreciate: true,
      lastLoginAt: true,
      orgUnit: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

  return users.map(({ orgUnit, ...user }) => ({
    ...user,
    orgUnitName: orgUnit.name,
  }));
}


export async function getManagedUser(
  db: ListUsersDb,
  userId: string,
): Promise<ManagedUser | null> {
  return readManagedUser(db, userId);
}


async function readManagedUser(
  db: ListUsersDb,
  userId: string,
): Promise<ManagedUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      orgUnitId: true,
      isUnitManager: true,
      isSystemAdmin: true,
      isRoot: true,
      canViewReports: true,
      canViewScoreReports: true,
      writesActivities: true,
      isActive: true,
      avatarExtension: true,
      isScored: true,
      canAppreciate: true,
      lastLoginAt: true,
      orgUnit: { select: { name: true } },
    },
  });

  if (!user) return null;
  const { orgUnit, ...rest } = user;
  return { ...rest, orgUnitName: orgUnit.name };
}


export async function countUsers(
  db: ListUsersDb,
  filters: UserListFilters = {},
): Promise<number> {
  return db.user.count({ where: userWhere(filters) });
}
