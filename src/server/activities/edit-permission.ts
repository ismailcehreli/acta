import type { ActivityApprovalStatus, PrismaClient } from "@prisma/client";

import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

import { checkEditWindow } from "./edit-window";

// Faaliyet düzenleme yetkisi (§5.5, §8.2). Liste, düzenleme ekranı ve yazma
// eylemi aynı kararı kullanır; aksi hâlde buton görünen bir kayıt gönderimde
// reddedilebilir ya da süresi dolmuş kayıt form açabilirdi.

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

/** Okuma sayımı zaten eldeyse ağ çağrısı yapmadan aynı kuralı uygular. */
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

  // Müdür düzeltme istemişse bu kayıt özel olarak yazara geri döner; kısa
  // pencereye bağlı değildir. Yazılan düzeltme yeniden onaya gönderilir.
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

/** Düzenleme kararının tek veritabanı okuma yolu. */
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
    return "Faaliyet okundu; artık değiştirilemez. Gerekiyorsa yeni bir faaliyet yazın.";
  }
  if (reason === "window_closed") {
    return "Düzeltme süresi doldu. Faaliyet kayıttan sonraki kısa süre içinde düzeltilebilir.";
  }
  return "Bu faaliyet şu anda düzenlenemez.";
}
