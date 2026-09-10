import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { GECERLI_DONEM } from "@/server/absence/period-filter";
import { countUnreadInScope } from "@/server/activities/unread";
import { countUnseen, listInbox } from "@/server/notifications/inbox";
import { listPendingApprovals } from "@/server/activities/approval";
import { countDrafts } from "@/server/activities/drafts";
import { subordinateUserIds } from "@/server/authz/visibility";
import type { CurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";

import type { ShellUser } from "./app-shell";
import {
  SETTING_KEYS,
  readBooleanSetting,
} from "@/server/settings/system-settings";

/**
 * Kabuğun ihtiyaç duyduğu kullanıcı özeti.
 *
 * Her sayfanın astlarını kendi sorgulaması, "Ekip" bağlantısının bir sayfada
 * görünüp diğerinde görünmemesi gibi sessiz tutarsızlıklar üretiyordu. Tek
 * yerden hesaplanır.
 */
export async function toShellUser(
  user: CurrentUser,
  /** Sayfa astları zaten hesapladıysa tekrar sorgulanmaz. */
  precomputedSubordinates?: string[],
): Promise<ShellUser> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(prisma, user.id));
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const now = new Date();

  const [bildirimler, gorulmemis, onaylar, taslaklar, vekalet, scoringEnabled] =
    await Promise.all([
    listInbox(prisma, user.id),
    countUnseen(prisma, user.id),
    // Onay bölümü **yalnız onay görevi olan** kullanıcıda çizilir: göremeyeceği
    // bir bölüme götüren bağlantı, yetkisiz ekranla karşılaşma demektir.
    listPendingApprovals(prisma, user.id),
    countDrafts(prisma, user.id),
    // Vekâlet bölümü yalnız ilgisi olanda çizilir: hiç vekâlet etmemiş ve
    // yerine bakılmamış kişide boş bir sayfaya götüren bağlantı olmaz.
    prisma.noActivityPeriod.findMany({
      where: {
        ...GECERLI_DONEM,
        OR: [{ deputyId: user.id }, { userId: user.id, deputyId: { not: null } }],
      },
      select: { deputyId: true, startDate: true, endDate: true },
    }),
      readBooleanSetting(prisma, SETTING_KEYS.scoringEnabled),
  ]);

  const bugun = toDateValue(companyDay(now));
  const aktifVekalet = vekalet.filter(
    (satir) =>
      satir.deputyId === user.id &&
      satir.startDate <= bugun &&
      satir.endDate >= bugun,
  ).length;

  return {
    id: user.id,
    fullName: user.fullName,
    avatarExtension: user.avatarExtension,
    mustChangePassword: user.mustChangePassword,
    scoringEnabled,
    notifications: bildirimler.map((item) => ({
      id: item.id,
      summary: item.summary,
      activityNo: item.activityNo,
      path: item.path,
      age: item.age,
      seen: item.seen,
    })),
    unseenNotifications: gorulmemis,
    isSystemAdmin: user.isSystemAdmin,
    isUnitManager: user.isUnitManager,
    canViewReports: user.canViewReports,
    canViewScoreReports: user.canViewScoreReports,
    hasTeam: subordinates.length > 0,
    writesActivities: user.writesActivities,
    pendingApprovals: onaylar.length,
    draftCount: taslaklar,
    hasDeputyHistory: vekalet.length > 0,
    activeDeputyCount: aktifVekalet,
    unreadCount: await countUnreadInScope(prisma, viewer, subordinates),
  };
}
