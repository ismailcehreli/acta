import type { ActivityApprovalStatus, PrismaClient } from "@prisma/client";

import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

import { checkEditWindow } from "./edit-window";





export type ActivityEditRefusal =
  | "window_closed"
  | "already_read"
  | "not_editable";

export type ActivityEditPermission =
  | { allowed: true }
  | { allowed: false; reason: ActivityEditRefusal };

export interface EditableActivityState {
  id: string;
  approvalStatus: ActivityApprovalStatus;
  createdAt: Date;
}

export type EditPermissionDb = Pick<
  PrismaClient,
  "systemSetting" | "readReceipt"
>;


export function evaluateActivityEditPermission(
  activity: EditableActivityState,
  now: Date,
  windowMinutes: number,
  readByOthers: boolean,
): ActivityEditPermission {
  if (
    activity.approvalStatus === "CANCELLED" ||
    activity.approvalStatus === "REJECTED"
  ) {
    return { allowed: false, reason: "not_editable" };
  }



  if (activity.approvalStatus === "CHANGES_REQUESTED") {
    return { allowed: true };
  }

  const refusal = checkEditWindow({
    createdAt: activity.createdAt,
    now,
    windowMinutes,
    readByOthers,
  });

  if (refusal === "already_read" || refusal === "window_closed") {
    return { allowed: false, reason: refusal };
  }

  return { allowed: true };
}


export async function checkActivityEditPermission(
  db: EditPermissionDb,
  authorId: string,
  activity: EditableActivityState,
  now: Date,
): Promise<ActivityEditPermission> {
  if (
    activity.approvalStatus === "CANCELLED" ||
    activity.approvalStatus === "REJECTED" ||
    activity.approvalStatus === "CHANGES_REQUESTED"
  ) {
    return evaluateActivityEditPermission(activity, now, 0, false);
  }

  const [windowMinutes, readCount] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.editWindowMinutes),
    db.readReceipt.count({
      where: { activityId: activity.id, userId: { not: authorId } },
    }),
  ]);

  return evaluateActivityEditPermission(
    activity,
    now,
    windowMinutes,
    readCount > 0,
  );
}

export function editPermissionMessage(reason: ActivityEditRefusal): string {
  if (reason === "already_read") {
    return "The activity has been read and can no longer be changed. Write a new activity if necessary.";
  }
  if (reason === "window_closed") {
    return "The revision window has expired. An activity can only be revised for a short time after it is recorded.";
  }
  return "This activity cannot be edited in its current state.";
}
