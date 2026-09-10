import type { IkonAdi } from "./nav-icons";

// Gezinme modeli.
//
// **Kullanıcının göremeyeceği bölüm hiç render edilmez** (brief §5).
// Gezinme, yetkisiz bir sayfaya götürüp sonra hata gösterme modeline
// dayanmaz — görmediği bağlantı kullanıcıyı hiç oraya götürmez.

export interface NavItem {
  href: string;
  label: string;
  icon: IkonAdi;
  /** Yanında görünen sayı; sıfırsa çizilmez. "0" bir haber değildir. */
  count?: number;
  /** Sayının ekran okuyucuda ne anlama geldiği. */
  countLabel?: string;
}

export interface NavModel {
  /** Kullanıcının kendi iş akışı. */
  personal: NavItem[];
  /** Kullanıcının yönettiği alan. */
  management: NavItem[];
  /** Yardım ve iletişim bağlantıları. */
  common: NavItem[];
  /** Sistem çalışma alanı; yalnız sistem yöneticisinde dolu. */
  admin: NavItem[];
  /** Faaliyet yazan kullanıcıda sürekli erişilebilir birincil eylem. */
  primaryAction: { href: string; label: string } | null;
}

export interface NavUser {
  isSystemAdmin: boolean;
  hasTeam: boolean;
  writesActivities: boolean;
  /** Vekâlet geçmişi ya da aktif vekâleti var mı; bölüm buna bağlı. */
  hasDeputyHistory: boolean;
  /** Şu an vekâlet ediyor mu; rozet buna bağlı. */
  activeDeputyCount: number;
  /** Gönderilmemiş taslak sayısı; sıfırsa bölüm hiç çizilmez. */
  draftCount: number;
  unreadCount: number;
  pendingApprovals: number;
  /** Skor sistemi açık mı; skor bölümü buna bağlı (Görev 11.11). */
  scoringEnabled: boolean;
  /** Yönetim raporlarını görebilir mi? */
  canViewReports: boolean;
  /** Skor ve takdir raporlarını görebilir mi? */
  canViewScoreReports: boolean;
}

function feedHref(unreadCount: number): string {
  return unreadCount > 0 ? "/feed?period=all&okunmamis=1" : "/feed";
}

import { createTranslator, DEFAULT_LOCALE, type TranslateFunction } from "@/shared/i18n";

export function buildNav(user: NavUser, t?: TranslateFunction): NavModel {
  const tr = t ?? createTranslator(DEFAULT_LOCALE);

  const personal: NavItem[] = [
    {
      href: "/",
      label: tr("nav.today"),
      icon: "bugun",
    },
    { href: "/activities", label: tr("nav.myActivities"), icon: "faaliyet" },
  ];

  if (!user.hasTeam) {
    personal.push({
      href: feedHref(user.unreadCount),
      label: tr("nav.feed"),
      icon: "akis",
      count: user.unreadCount,
      countLabel: tr("nav.unreadCountLabel"),
    });
  }

  // Taslak bölümü **her zaman** görünür.
  personal.push({
    href: "/drafts",
    label: tr("nav.drafts"),
    icon: "taslak",
    count: user.draftCount > 0 ? user.draftCount : undefined,
    countLabel: tr("nav.draftCountLabel"),
  });

  // Onay bölümü yalnız onay görevi olan kullanıcıda.
  if (user.pendingApprovals > 0) {
    personal.push({
      href: "/approvals",
      label: tr("nav.approvals"),
      icon: "onay",
      count: user.pendingApprovals,
      countLabel: tr("nav.approvalCountLabel"),
    });
  }

  personal.push(
    { href: "/follow-ups", label: tr("nav.followUps"), icon: "takip" },
    { href: "/search", label: tr("common.search"), icon: "arama" },
  );

  personal.push({ href: "/absence", label: tr("nav.absence"), icon: "izin" });

  const common: NavItem[] = [
    { href: "/yardim", label: tr("nav.help"), icon: "yardim" },
    { href: "/feedback", label: tr("nav.feedback"), icon: "geriBildirim" },
  ];

  const management: NavItem[] = [];

  if (user.hasTeam) {
    management.push(
      {
        href: feedHref(user.unreadCount),
        label: tr("nav.managedActivities"),
        icon: "akis",
        count: user.unreadCount,
        countLabel: tr("nav.unreadCountLabel"),
      },
      { href: "/team/absence", label: tr("nav.managedAbsence"), icon: "ekip" },
    );

    if (user.scoringEnabled) {
      management.push({ href: "/scores", label: tr("nav.scores"), icon: "skor" });
    }
  }

  if (user.canViewReports) {
    management.push({ href: "/reports", label: tr("nav.reports"), icon: "rapor" });
  }

  if (user.hasDeputyHistory) {
    personal.push({
      href: "/deputy",
      label: tr("nav.deputy"),
      icon: "vekalet",
      count: user.activeDeputyCount,
      countLabel: tr("nav.activeDeputyCountLabel"),
    });
  }

  const admin: NavItem[] = user.isSystemAdmin
    ? [
        { href: "/admin/org", label: tr("nav.orgTree"), icon: "yonetim" },
        { href: "/admin/users", label: tr("nav.users"), icon: "ekip" },
        { href: "/admin/calendar", label: tr("nav.calendar"), icon: "bugun" },
        { href: "/admin/approval-reasons", label: tr("nav.approvalReasons"), icon: "onay" },
        { href: "/admin/settings", label: tr("nav.settings"), icon: "yonetim" },
        { href: "/admin/jobs", label: tr("nav.jobs"), icon: "takip" },
        { href: "/admin/audit", label: tr("nav.audit"), icon: "faaliyet" },
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

/**
 * Mobil alt gezinme: **en fazla beş öğe** (brief §5). Sıra bilinçli —
 * "Yeni" ortada, başparmağın doğal yerinde; ama kullanıcıya düşen kritik
 * işin (Bugün'deki sayaç) önüne görsel olarak geçmez.
 */
export function mobileTabs(model: NavModel): NavItem[] {
  const mobileNav = [...model.personal, ...model.management];
  const bugun = mobileNav.find((item) => item.href === "/");
  const akis = mobileNav.find((item) => item.href.split("?")[0] === "/feed");
  const faaliyet = mobileNav.find((item) => item.href === "/activities");
  const arama = mobileNav.find((item) => item.href === "/search");
  const onay = mobileNav.find((item) => item.href === "/approvals");

  const tabs: NavItem[] = [];
  if (bugun) tabs.push(bugun);
  // Onay görevi varsa faaliyet listesinin yerini alır: bekleyen iş,
  // kendi arşivinden önce gelir.
  if (onay) tabs.push(onay);
  else if (faaliyet) tabs.push(faaliyet);
  // Akış okunmamış rozetini taşıyor; telefonda da erişilebilir olmalı.
  if (akis) tabs.push(akis);
  if (arama) tabs.push(arama);

  return tabs;
}

/** Bağlantı bu yolda aktif mi? */
export function isActive(pathname: string, href: string): boolean {
  const route = href.split("?")[0];
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}
