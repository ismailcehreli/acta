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

export function buildNav(user: NavUser): NavModel {
  const personal: NavItem[] = [
    {
      href: "/",
      label: "Bugün",
      icon: "bugun",
    },
    { href: "/activities", label: "Faaliyetlerim", icon: "faaliyet" },
  ];

  if (!user.hasTeam) {
    personal.push({
      href: feedHref(user.unreadCount),
      label: "Faaliyet akışı",
      icon: "akis",
      count: user.unreadCount,
      countLabel: "okunmamış faaliyet",
    });
  }

  // Taslak bölümü **her zaman** görünür (ürün sahibi kararı, 21.08.2026).
  //
  // Önceden yalnız taslağı olan kullanıcıda görünüyordu; gerekçe "boş kutuya
  // götüren bağlantı yer kaplar" idi. Yanlış çıktı: kaybolan menü öğesi
  // kullanıcıya özelliğin varlığını hiç öğretmiyor, taslak bitince de
  // "nereye gitti" diye aratıyordu. Sabit gezinme öğrenilebilir, değişen
  // gezinme değil. Sayaç sıfırken yazılmaz — rozet dikkat çeker, boş kutu
  // dikkat istemiyor.
  personal.push({
    href: "/drafts",
    label: "Taslaklar",
    icon: "taslak",
    count: user.draftCount > 0 ? user.draftCount : undefined,
    countLabel: "gönderilmemiş taslak",
  });

  // Onay bölümü yalnız onay görevi olan kullanıcıda.
  if (user.pendingApprovals > 0) {
    personal.push({
      href: "/approvals",
      label: "Onaylar",
      icon: "onay",
      count: user.pendingApprovals,
      countLabel: "onay bekleyen kayıt",
    });
  }

  personal.push(
    { href: "/follow-ups", label: "Takipler", icon: "takip" },
    { href: "/search", label: "Arama", icon: "arama" },
  );

  // Kendi izin günleri herkeste (Görev 11.8): izin girişi artık kişinin
  // kendisine açık.
  personal.push({ href: "/absence", label: "İzinlerim", icon: "izin" });

  const common: NavItem[] = [
    { href: "/yardim", label: "Yardım", icon: "yardim" },
    { href: "/feedback", label: "Geri bildirim", icon: "geriBildirim" },
  ];

  const management: NavItem[] = [];

  if (user.hasTeam) {
    management.push(
      {
        href: feedHref(user.unreadCount),
        label: "Yönettiğim faaliyetler",
        icon: "akis",
        count: user.unreadCount,
        countLabel: "okunmamış faaliyet",
      },
      { href: "/team/absence", label: "Yönettiğim izinler", icon: "ekip" },
    );
    // Skor bölümü yalnız açıkken: kapalı bir sistemin boş sayfasına götüren
    // bağlantı, her gün görülen gezinmede yer kaplamaktan başka bir şey
    // yapmaz (Görev 11.11).
    if (user.scoringEnabled) {
      management.push({ href: "/scores", label: "Skorlar", icon: "skor" });
    }
  }

  if (user.canViewReports) {
    management.push({ href: "/reports", label: "Raporlar", icon: "rapor" });
  }

  // Vekâlet bölümü yalnız ilgisi olanda: hiç vekâlet etmemiş ve yerine
  // bakılmamış birinde boş bir sayfaya götüren bağlantı yer kaplamaktan
  // başka bir şey yapmaz.
  if (user.hasDeputyHistory) {
    personal.push({
      href: "/deputy",
      label: "Vekâlet",
      icon: "vekalet",
      count: user.activeDeputyCount,
      countLabel: "aktif vekâlet",
    });
  }

  const admin: NavItem[] = user.isSystemAdmin
    ? [
        { href: "/admin/org", label: "Organizasyon", icon: "yonetim" },
        { href: "/admin/users", label: "Kullanıcılar", icon: "ekip" },
        { href: "/admin/calendar", label: "Çalışma takvimi", icon: "bugun" },
        { href: "/admin/approval-reasons", label: "Onay gerekçeleri", icon: "onay" },
        { href: "/admin/settings", label: "Sistem ayarları", icon: "yonetim" },
        { href: "/admin/jobs", label: "Zamanlanmış işler", icon: "takip" },
        { href: "/admin/audit", label: "İşlem kayıtları", icon: "faaliyet" },
      ]
    : [];

  return {
    personal,
    management,
    common,
    admin,
    primaryAction: user.writesActivities
      ? { href: "/activities/new", label: "Yeni faaliyet" }
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
