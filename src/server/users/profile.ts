import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import {
  countVisibleActivities,
  findVisibleActivity,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  subordinateUserIds,
  type Viewer,
} from "@/server/authz/visibility";



//



//



export type ProfileDb = Pick<
  PrismaClient,
  | "user"
  | "orgUnit"
  | "activityApprover"
  | "noActivityPeriod"
  | "$queryRaw"
> & ActivityRepositoryDb;

export type ProfileAccess = "full" | "metadata" | "none";

export interface ProfilePerson {
  id: string;
  fullName: string;

  title: string | null;
  email: string;
  orgUnitName: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  writesActivities: boolean;
  isActive: boolean;

  lastLoginAt: Date | null;

  lastLoginVisible: boolean;

  avatarExtension: string | null;
}

export interface ProfileViewer extends Viewer {

  orgUnitId?: string;
  isUnitManager?: boolean;
}

export interface ProfileStats {

  total: number;

  thisMonth: number;

  pending: number;

  lastActivityDate: Date | null;
}

export type ProfileResult =
  | { access: "none" }
  | { access: "metadata"; person: ProfilePerson }
  | { access: "full"; person: ProfilePerson; stats: ProfileStats };



export async function resolveProfileAccess(
  db: ProfileDb,
  viewer: Viewer,
  userId: string,
): Promise<"none" | "metadata" | "full"> {
  if (viewer.id === userId) return "full";

  const subordinates = await subordinateUserIds(db, viewer.id);
  if (subordinates.includes(userId)) return "full";

  return viewer.isSystemAdmin ? "metadata" : "none";
}

export async function loadProfile(
  db: ProfileDb,
  viewer: ProfileViewer,
  userId: string,
  now: Date,
): Promise<ProfileResult> {
  const person = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      isUnitManager: true,
      isSystemAdmin: true,
      writesActivities: true,
      isActive: true,
      lastLoginAt: true,
      avatarExtension: true,
      orgUnit: { select: { id: true, name: true } },
    },
  });

  if (!person) return { access: "none" };

  const lastLoginVisible =
    viewer.id === person.id ||
    viewer.isSystemAdmin ||
    (viewer.isUnitManager === true &&
      viewer.orgUnitId === person.orgUnit.id &&
      !person.isUnitManager);

  const personDetails: ProfilePerson = {
    id: person.id,
    fullName: person.fullName,
    title: person.title,
    email: person.email,
    orgUnitName: person.orgUnit.name,
    isUnitManager: person.isUnitManager,
    isSystemAdmin: person.isSystemAdmin,
    writesActivities: person.writesActivities,
    isActive: person.isActive,
    lastLoginAt: lastLoginVisible ? person.lastLoginAt : null,
    lastLoginVisible,
    avatarExtension: person.avatarExtension,
  };

  const access = await resolveProfileAccess(db, viewer, userId);
  if (access === "none") return { access: "none" };
  if (access === "metadata") return { access: "metadata", person: personDetails };

  const monthStart = new Date(
    Date.UTC(
      toDateValue(companyDay(now)).getUTCFullYear(),
      toDateValue(companyDay(now)).getUTCMonth(),
      1,
    ),
  );

  const [total, thisMonth, pending, lastRecord] = await Promise.all([
    countVisibleActivities(db, viewer, { authorId: userId }),
    countVisibleActivities(db, viewer, {
      authorId: userId,
      activityDate: { gte: monthStart },
    }),
    countVisibleActivities(db, viewer, {
      authorId: userId,
      approvalStatus: "PENDING_APPROVAL",
    }),
    findVisibleActivity(db, viewer, {
      where: { authorId: userId },
      orderBy: { activityDate: "desc" },
      select: { activityDate: true },
    }),
  ]);

  return {
    access: "full",
    person: personDetails,
    stats: {
      total,
      thisMonth,
      pending,
      lastActivityDate: lastRecord?.activityDate ?? null,
    },
  };
}

export interface ProfileActivityRow {
  id: string;
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
}


export async function listProfileActivities(
  db: ProfileDb,
  viewer: Viewer,
  userId: string,
  limit = 50,
): Promise<ProfileActivityRow[]> {
  const records = await listVisibleActivities(db, viewer, {
    where: { authorId: userId },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      approvalStatus: true,
    },
  });



  return records;
}
