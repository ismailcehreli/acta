import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { CURRENT_PERIOD } from "@/server/absence/period-filter";
import { countUnreadInScope } from "@/server/activities/unread";
import { countUnseen, listInbox } from "@/server/notifications/inbox";
import { listPendingApprovals } from "@/server/activities/approval";
import { countDrafts } from "@/server/activities/drafts";
import { subordinateUserIds } from "@/server/authz/visibility";
import type { CurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getLocale } from "@/server/i18n/locale";

import type { ShellUser } from "./app-shell";
import {
  SETTING_KEYS,
  readBooleanSetting,
} from "@/server/settings/system-settings";


export async function toShellUser(
  user: CurrentUser,

  precomputedSubordinates?: string[],
): Promise<ShellUser> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(prisma, user.id));
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const now = new Date();
  const locale = await getLocale();

  const [notifications, unseenNotifications, approvals, drafts, deputy, scoringEnabled] =
    await Promise.all([
    listInbox(prisma, user.id, undefined, now, locale),
    countUnseen(prisma, user.id),


    listPendingApprovals(prisma, user.id),
    countDrafts(prisma, user.id),


    prisma.noActivityPeriod.findMany({
      where: {
        ...CURRENT_PERIOD,
        OR: [{ deputyId: user.id }, { userId: user.id, deputyId: { not: null } }],
      },
      select: { deputyId: true, startDate: true, endDate: true },
    }),
      readBooleanSetting(prisma, SETTING_KEYS.scoringEnabled),
  ]);

  const today = toDateValue(companyDay(now));
  const activeDeputy = deputy.filter(
    (row) =>
      row.deputyId === user.id &&
      row.startDate <= today &&
      row.endDate >= today,
  ).length;

  return {
    id: user.id,
    fullName: user.fullName,
    avatarExtension: user.avatarExtension,
    mustChangePassword: user.mustChangePassword,
    scoringEnabled,
    notifications: notifications.map((item) => ({
      id: item.id,
      summary: item.summary,
      activityNo: item.activityNo,
      path: item.path,
      age: item.age,
      seen: item.seen,
    })),
    unseenNotifications,
    isSystemAdmin: user.isSystemAdmin,
    isUnitManager: user.isUnitManager,
    canViewReports: user.canViewReports,
    canViewScoreReports: user.canViewScoreReports,
    hasTeam: subordinates.length > 0,
    writesActivities: user.writesActivities,
    pendingApprovals: approvals.length,
    draftCount: drafts,
    hasDeputyHistory: deputy.length > 0,
    activeDeputyCount: activeDeputy,
    unreadCount: await countUnreadInScope(prisma, viewer, subordinates),
  };
}
