import type { PrismaClient } from "@prisma/client";

import {
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import { SETTING_KEYS, readBooleanSetting } from "@/server/settings/system-settings";

import { acquireScoreMutationLock } from "./recalculation";


//



//



export type AppreciationDb = VisibilityDb &
  Pick<
    PrismaClient,
    "activityAppreciation" | "systemSetting" | "user" | "$transaction" | "$executeRaw"
  > &
  ActivityRepositoryDb;

export type AppreciationResult =
  | { ok: true }
  | {
      ok: false;
      error: "disabled" | "not_authorized" | "not_found" | "own_activity";
      message: string;
    };


export async function appreciateActivity(
  db: AppreciationDb,
  userId: string,
  activityId: string,
  now: Date,
): Promise<AppreciationResult> {
  return db.$transaction(async (tx) => {



    await acquireScoreMutationLock(tx);

    if (!(await readBooleanSetting(tx, SETTING_KEYS.appreciationEnabled))) {
      return {
        ok: false,
        error: "disabled",
        message: "The appreciation system is disabled.",
      };
    }

    const person = await tx.user.findUnique({
      where: { id: userId },
      select: { canAppreciate: true, isActive: true, isSystemAdmin: true },
    });
    if (!person?.isActive || !person.canAppreciate) {
      return {
        ok: false,
        error: "not_authorized",
        message: "You are not authorized to give appreciation.",
      };
    }

    const record = await findVisibleActivity(
      tx,
      {
        id: userId,
        isSystemAdmin: person.isSystemAdmin,
      },
      {
        where: { id: activityId },
        select: {
          id: true,
          authorId: true,
          authorOrgUnitId: true,
          approvalStatus: true,
          approverId: true,
        },
      },
    );
    if (!record) {
      return { ok: false, error: "not_found", message: "Record not found." };
    }

    if (record.authorId === userId) {
      return {
        ok: false,
        error: "own_activity",
        message: "You cannot appreciate your own activity.",
      };
    }



    await tx.activityAppreciation.upsert({
      where: { activityId_userId: { activityId, userId } },
      update: {},
      create: { activityId, userId, createdAt: now },
    });

    return { ok: true };
  });
}


export async function countAppreciations(
  db: AppreciationDb,
  activityId: string,
): Promise<number> {
  return db.activityAppreciation.count({ where: { activityId } });
}


export async function countAppreciationsForUser(
  db: AppreciationDb,
  viewer: Viewer,
  userId: string,
  from: Date,
  to: Date,
): Promise<number | null> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.appreciationEnabled))) {
    return null;
  }

  const scope = await visibleActivityWhere(db, viewer);

  return db.activityAppreciation.count({
    where: {
      createdAt: { gte: from, lte: to },
      activity: { AND: [scope, { authorId: userId }] },
    },
  });
}
