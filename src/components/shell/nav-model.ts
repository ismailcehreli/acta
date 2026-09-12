import type { IconName } from "./nav-icons";

// Navigation model.
//




export interface NavItem {
  href: string;
  label: string;
  icon: IconName;

  count?: number;

  countLabel?: string;
}

export interface NavModel {

  personal: NavItem[];

  management: NavItem[];

  common: NavItem[];

  admin: NavItem[];

  primaryAction: { href: string; label: string } | null;
}

export interface NavUser {
  isSystemAdmin: boolean;
  hasTeam: boolean;
  writesActivities: boolean;

  hasDeputyHistory: boolean;

  activeDeputyCount: number;

  draftCount: number;
  unreadCount: number;
  pendingApprovals: number;

  scoringEnabled: boolean;

  canViewReports: boolean;

  canViewScoreReports: boolean;
}

function feedHref(unreadCount: number): string {
  return unreadCount > 0 ? "/feed?period=all&unread=1" : "/feed";
}

import { createTranslator, DEFAULT_LOCALE, type TranslateFunction } from "@/shared/i18n";

export function buildNav(user: NavUser, t?: TranslateFunction): NavModel {
  const tr = t ?? createTranslator(DEFAULT_LOCALE);

  const personal: NavItem[] = [
    {
      href: "/",
      label: tr("nav.today"),
      icon: "today",
    },
    { href: "/activities", label: tr("nav.myActivities"), icon: "activity" },
  ];

  if (!user.hasTeam) {
    personal.push({
      href: feedHref(user.unreadCount),
      label: tr("nav.feed"),
      icon: "feed",
      count: user.unreadCount,
      countLabel: tr("nav.unreadCountLabel"),
    });
  }


  personal.push({
    href: "/drafts",
    label: tr("nav.drafts"),
    icon: "draft",
    count: user.draftCount > 0 ? user.draftCount : undefined,
    countLabel: tr("nav.draftCountLabel"),
  });


  if (user.pendingApprovals > 0) {
    personal.push({
      href: "/approvals",
      label: tr("nav.approvals"),
      icon: "approval",
      count: user.pendingApprovals,
      countLabel: tr("nav.approvalCountLabel"),
    });
  }

  personal.push(
    { href: "/follow-ups", label: tr("nav.followUps"), icon: "followUp" },
    { href: "/search", label: tr("common.search"), icon: "search" },
  );

  personal.push({ href: "/absence", label: tr("nav.absence"), icon: "leave" });

  const common: NavItem[] = [
    { href: "/help", label: tr("nav.help"), icon: "help" },
    { href: "/feedback", label: tr("nav.feedback"), icon: "feedback" },
  ];

  const management: NavItem[] = [];

  if (user.hasTeam) {
    management.push(
      {
        href: feedHref(user.unreadCount),
        label: tr("nav.managedActivities"),
        icon: "feed",
        count: user.unreadCount,
        countLabel: tr("nav.unreadCountLabel"),
      },
      { href: "/team/absence", label: tr("nav.managedAbsence"), icon: "team" },
    );

    if (user.scoringEnabled) {
      management.push({ href: "/scores", label: tr("nav.scores"), icon: "score" });
    }
  }

  if (user.canViewReports) {
    management.push({ href: "/reports", label: tr("nav.reports"), icon: "report" });
  }

  if (user.hasDeputyHistory) {
    personal.push({
      href: "/deputy",
      label: tr("nav.deputy"),
      icon: "deputy",
      count: user.activeDeputyCount,
      countLabel: tr("nav.activeDeputyCountLabel"),
    });
  }

  const admin: NavItem[] = user.isSystemAdmin
    ? [
        { href: "/admin/org", label: tr("nav.orgTree"), icon: "management" },
        { href: "/admin/users", label: tr("nav.users"), icon: "team" },
        { href: "/admin/calendar", label: tr("nav.calendar"), icon: "today" },
        { href: "/admin/approval-reasons", label: tr("nav.approvalReasons"), icon: "approval" },
        { href: "/admin/settings", label: tr("nav.settings"), icon: "management" },
        { href: "/admin/jobs", label: tr("nav.jobs"), icon: "followUp" },
        { href: "/admin/audit", label: tr("nav.audit"), icon: "activity" },
      ]
    : [];

  return {
    personal,
    management,
    common,
    admin,
    primaryAction: user.writesActivities
      ? { href: "/activities/new", label: tr("nav.newAction") }
      : null,
  };
}


export function mobileTabs(model: NavModel): NavItem[] {
  const mobileNav = [...model.personal, ...model.management];
  const today = mobileNav.find((item) => item.href === "/");
  const feed = mobileNav.find((item) => item.href.split("?")[0] === "/feed");
  const activity = mobileNav.find((item) => item.href === "/activities");
  const search = mobileNav.find((item) => item.href === "/search");
  const approval = mobileNav.find((item) => item.href === "/approvals");

  const tabs: NavItem[] = [];
  if (today) tabs.push(today);


  if (approval) tabs.push(approval);
  else if (activity) tabs.push(activity);

  if (feed) tabs.push(feed);
  if (search) tabs.push(search);

  return tabs;
}


export function isActive(pathname: string, href: string): boolean {
  const route = href.split("?")[0];
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}
