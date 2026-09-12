import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/(auth)/logout/actions";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { APP_VERSION } from "@/server/version";
import { prisma } from "@/server/db";
import { readBranding } from "@/server/settings/branding";
import type { BellItem } from "./notification-bell";
import { markNotificationsSeenAction } from "./notification-actions";
import { ShellNav } from "./shell-nav";
import { initials } from "@/shared/format/avatar-initials";
import { getTranslations } from "@/server/i18n/server";
import { getLocale } from "@/server/i18n/locale";
import type { TranslateFunction } from "@/shared/i18n";






export interface ShellUser {
  id: string;
  fullName: string;

  avatarExtension: string | null;
  isSystemAdmin: boolean;
  isUnitManager: boolean;

  canViewReports: boolean;

  canViewScoreReports: boolean;

  hasTeam: boolean;

  writesActivities: boolean;

  pendingApprovals: number;

  draftCount: number;

  hasDeputyHistory: boolean;

  scoringEnabled: boolean;

  activeDeputyCount: number;

  unreadCount: number;

  notifications: BellItem[];
  unseenNotifications: number;

  mustChangePassword: boolean;
}


function roleLabel(user: ShellUser, t: TranslateFunction): string {
  if (user.isSystemAdmin) return t("roles.systemAdmin");
  if (user.isUnitManager) return t("roles.unitManager");
  return t("roles.user");
}


function roleList(user: ShellUser, t: TranslateFunction): string {
  const roles = [
    user.isSystemAdmin ? t("roles.systemAdmin") : null,
    user.isUnitManager ? t("roles.unitManager") : null,
  ].filter(Boolean);

  return roles.length > 0 ? roles.join(" · ") : t("roles.user");
}

export async function AppShell({
  user,
  children,
  allowPasswordChange = false,
}: {
  user: ShellUser;
  children: ReactNode;
  allowPasswordChange?: boolean;
}) {
  if (user.mustChangePassword && !allowPasswordChange) {
    redirect("/password?required=1");
  }

  const brand = await readBranding(prisma);
  const locale = await getLocale();
  const t = await getTranslations(locale);

  return (
    <div className="min-h-dvh">

      <LiveRefresh />

      <ShellNav
        brand={brand}
        notifications={user.notifications}
        unseenNotifications={user.unseenNotifications}
        markNotificationsSeen={markNotificationsSeenAction}
        user={{
          profileHref: `/users/${user.id}`,
          fullName: user.fullName,
          roleLabel: roleLabel(user, t),
          roleDetail: roleList(user, t),
          initials: initials(user.fullName, locale) || "?",
          id: user.id,
          avatarExtension: user.avatarExtension,
          locale,
          scoringEnabled: user.scoringEnabled,
          isSystemAdmin: user.isSystemAdmin,
          canViewReports: user.canViewReports,
          canViewScoreReports: user.canViewScoreReports,
          hasTeam: user.hasTeam,
          writesActivities: user.writesActivities,
          draftCount: user.draftCount,
          hasDeputyHistory: user.hasDeputyHistory,
          activeDeputyCount: user.activeDeputyCount,
          unreadCount: user.unreadCount,
          pendingApprovals: user.pendingApprovals,
        }}
        logout={logoutAction}
      />

      {/* Content sits to the right of the spine; on mobile, leave room for the
          bottom navigation so the last row is not hidden (including safe area). */}
      <div className="flex min-h-dvh flex-col xl:ps-(--spacing-spine)">
        <div className="flex-1 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>

        {/* Footer: organization text, copyright, and version. The version comes
            from `package.json`, giving support one reliable place to check it. */}
        <footer className="border-t border-line bg-raised">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3.5 text-[length:var(--text-2xs)] text-faint sm:px-7">
            <span>
              © {new Date().getFullYear()} {brand.footerText}. {t("common.allRightsReserved")}
            </span>
            {APP_VERSION ? (
                <span className="mono">{t("common.version", { version: APP_VERSION })}</span>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
