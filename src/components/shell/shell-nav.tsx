"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Menu, MenuHeader, MenuSeparator, MenuSubmit } from "@/components/ui/menu";

import { NavIcon } from "./nav-icons";
import { Avatar } from "@/components/ui/avatar";
import {
  NotificationBell,
  NotificationToast,
  type BellItem,
} from "./notification-bell";
import {
  buildNav,
  isActive,
  mobileTabs,
  type NavItem,
  type NavUser,
} from "./nav-model";

// Uygulama kabuğu (brief §5).
//
// Üç düzen, tek öğrenilen dil:
//
//   ≥1280 px  Kalıcı sol operasyon omurgası. Marka, birincil eylem,
//             bölümler, en altta hesap. İçerik omurganın sağında.
//   768–1279  Üstte bağlam çubuğu + tam etiketli drawer. Dar ikon şeridi
//             **kullanılmadı**: ikon tek başına metnin yerini almamalı (§3).
//   <768      Üstte bağlam çubuğu + altta en fazla beş öğeli gezinme.
//             "Daha" aynı drawer'ı açar.
//
// Drawer ve menüler odak yönetimi, Escape ve geri odaklandırma taşır (§10).

export interface ShellNavUser extends NavUser {
  profileHref: string;
  fullName: string;
  /** Hesap satırında görünen tek yetki. */
  roleLabel: string;
  /** Hesap menüsünde görünen tam yetki listesi. */
  roleDetail: string;
  initials: string;
  /** Hesap rozeti için: kimlik ve profil resmi uzantısı (Görev 11.5). */
  id: string;
  avatarExtension: string | null;
}

/** Tıklanan bağlantının bekleme göstergesi; HTTP anlamını değiştirmez. */
function LinkBekliyor() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label="Yükleniyor"
      className="ms-auto inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
    />
  );
}

/** Sayı rozeti; sıfırda hiç çizilmez. */
function Count({ item }: { item: NavItem }) {
  if (!item.count) return null;

  return (
    <span className="ms-auto inline-flex min-w-5 items-center justify-center rounded-(--radius-xs) bg-primary px-1 text-[length:var(--text-2xs)] font-semibold text-white tabular">
      <span aria-hidden>{item.count > 99 ? "99+" : item.count}</span>
      <span className="sr-only">
        {item.count} {item.countLabel ?? "bekleyen"}
      </span>
    </span>
  );
}

function SpineLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const aktif = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={aktif ? "page" : undefined}
      className={[
        "group relative flex min-h-(--spacing-touch) items-center gap-3 px-3 py-2",
        "text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
        aktif
          ? "bg-surface font-semibold text-ink"
          : "text-muted hover:bg-surface-hover hover:text-ink",
      ].join(" ")}
    >
      {/* Aktif bölümün kenar işareti: renk tek taşıyıcı değil, konum ve
          ağırlık da ayırt ediyor. */}
      <span
        aria-hidden
        className={
          aktif
            ? "absolute inset-y-0 start-0 w-[3px] bg-primary"
            : "absolute inset-y-0 start-0 w-[3px] bg-transparent"
        }
      />
      <NavIcon name={item.icon} className={aktif ? "size-5 shrink-0 text-primary" : "size-5 shrink-0"} />
      <span className="truncate">{item.label}</span>
      <Count item={item} />
      <LinkBekliyor />
    </Link>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col">
      <span className="section-label px-3 pt-5 pb-2">{label}</span>
      {items.map((item) => (
        <SpineLink
          key={item.href}
          item={item}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function Brand({
  brand,
  compact,
}: {
  brand: { pageTitle: string; logoUrl: string | null };
  compact?: boolean;
}) {
  // Bu alan **logonun yeri**. Logo yüklendiğinde tek görünen o olur.
  //
  // Logo yokken sayfa başlığı yazılır ama başlık gibi değil, sakin bir künye
  // gibi: küçük punto, iki satıra kadar sarar. Önce tek satırda kırpılıyordu
  // ("Faaliyet Raporlama Sis…") — yarısı görünmeyen bir metin, hem yer
  // kaplıyor hem bilgi vermiyordu.
  return (
    <Link
      href="/"
      className="flex min-w-0 items-center rounded-(--radius-xs) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoUrl}
          alt={brand.pageTitle}
          className={compact ? "h-7 w-auto max-w-40 object-contain" : "h-9 w-auto max-w-full object-contain"}
        />
      ) : (
        <span
          className={
            compact
              ? "min-w-0 truncate text-[length:var(--text-sm)] font-semibold tracking-[var(--tracking-tight)] text-ink"
              : "text-[length:var(--text-sm)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance text-ink"
          }
        >
          {brand.pageTitle}
        </span>
      )}
    </Link>
  );
}

function AccountMenu({
  user,
  logout,
  align = "right",
}: {
  user: ShellNavUser;
  logout: () => Promise<void>;
  align?: "left" | "right";
}) {
  return (
    <Menu
      label="Hesap menüsü"
      align={align}
      // Hesap bloğu kabuğun **en altında**: menü aşağı açılsa ekran dışına
      // taşar ve tıklanamaz olurdu.
      placement="top"
      trigger={
        <>
          <Avatar
            user={{
              id: user.id,
              fullName: user.fullName,
              avatarExtension: user.avatarExtension,
            }}
            size={32}
          />
          <span className="min-w-0 flex-1 text-start">
            <span className="block truncate text-[length:var(--text-sm)] font-medium text-ink">
              {user.fullName}
            </span>
            <span className="block truncate text-[length:var(--text-2xs)] text-faint">
              {user.roleLabel}
            </span>
          </span>
        </>
      }
    >
      <MenuHeader>
        <span className="block font-medium text-ink">{user.fullName}</span>
        <span className="block">{user.roleDetail}</span>
      </MenuHeader>

      <Link
        href={user.profileHref}
        role="menuitem"
        className="flex min-h-(--spacing-touch) w-full items-center px-3 text-[length:var(--text-sm)] text-ink transition-colors hover:bg-surface-hover"
      >
        Profilim
      </Link>

      <Link
        href="/parola"
        role="menuitem"
        className="flex min-h-(--spacing-touch) w-full items-center px-3 text-[length:var(--text-sm)] text-ink transition-colors hover:bg-surface-hover"
      >
        Parolamı değiştir
      </Link>

      <MenuSeparator />

      <form action={logout}>
        <MenuSubmit>Çıkış yap</MenuSubmit>
      </form>
    </Menu>
  );
}

/**
 * Gezinme çekmecesi. Odak içeride tutulur, Escape kapatır ve odak açan
 * düğmeye geri döner (§10).
 */
function NavDrawer({
  open,
  onClose,
  brand,
  user,
  logout,
  pathname,
  personal,
  management,
  common,
  admin,
  primaryAction,
}: {
  open: boolean;
  onClose: () => void;
  brand: { pageTitle: string; logoUrl: string | null };
  user: ShellNavUser;
  logout: () => Promise<void>;
  pathname: string;
  personal: NavItem[];
  management: NavItem[];
  common: NavItem[];
  admin: NavItem[];
  primaryAction: { href: string; label: string } | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const basligiId = useId();

  useEffect(() => {
    if (!open) return;

    const onceki = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();

    function tus(olay: KeyboardEvent) {
      if (olay.key === "Escape") {
        onClose();
        return;
      }
      if (olay.key !== "Tab" || !panel.current) return;

      const odaklanabilir = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (odaklanabilir.length === 0) return;

      const ilk = odaklanabilir[0];
      const son = odaklanabilir[odaklanabilir.length - 1];

      if (olay.shiftKey && document.activeElement === ilk) {
        olay.preventDefault();
        son.focus();
      } else if (!olay.shiftKey && document.activeElement === son) {
        olay.preventDefault();
        ilk.focus();
      }
    }

    document.addEventListener("keydown", tus);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", tus);
      document.body.style.overflow = "";
      onceki?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] xl:hidden">
      <button
        type="button"
        aria-label="Menüyü kapat"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={basligiId}
        className="absolute inset-y-0 start-0 flex w-[min(86vw,320px)] flex-col border-e border-line bg-raised shadow-(--shadow-dialog)"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={basligiId} className="sr-only">
            Gezinme
          </h2>
          <Brand brand={brand} compact />
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="grid size-(--spacing-touch) place-items-center rounded-(--radius-sm) text-muted hover:bg-surface-hover hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="square" />
            </svg>
          </button>
        </div>

        <nav aria-label="Ana menü" className="flex-1 overflow-y-auto pb-4">
          {primaryAction ? (
            <div className="px-3 pt-3">
              <Link
                href={primaryAction.href}
                onClick={onClose}
                className="flex min-h-(--spacing-control-lg) items-center justify-center gap-2 rounded-(--radius-sm) bg-primary px-4 text-[length:var(--text-sm)] font-medium text-white hover:bg-primary-hover"
              >
                <NavIcon name="yeni" className="size-4" />
                {primaryAction.label}
              </Link>
            </div>
          ) : null}

          <NavGroup label="Benim işlerim" items={personal} pathname={pathname} onNavigate={onClose} />
          <NavGroup label="Yönettiğim alan" items={management} pathname={pathname} onNavigate={onClose} />
          <NavGroup label="Yardım ve iletişim" items={common} pathname={pathname} onNavigate={onClose} />
          <NavGroup label="Sistem yönetimi" items={admin} pathname={pathname} onNavigate={onClose} />
        </nav>

        <div className="border-t border-line p-2">
          <AccountMenu user={user} logout={logout} align="left" />
        </div>
      </div>
    </div>
  );
}

export function ShellNav({
  brand,
  user,
  notifications,
  unseenNotifications,
  markNotificationsSeen,
  logout,
}: {
  brand: { pageTitle: string; logoUrl: string | null };
  user: ShellNavUser;
  notifications: BellItem[];
  unseenNotifications: number;
  markNotificationsSeen: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  const model = buildNav(user);
  const tabs = mobileTabs(model);

  // Sayfa değişince çekmece kapanır; açık kalırsa yeni sayfayı örter.
  const [sonYol, setSonYol] = useState(pathname);
  if (sonYol !== pathname) {
    setSonYol(pathname);
    if (drawer) setDrawer(false);
  }

  return (
    <>
      {/* Anlık kutucuk sayfada **tek**: zil iki kırılım noktasında iki kez
          monte oluyor (biri gizli), kutucuk zilin içinde kalsaydı aynı
          bildirim iki kez belirirdi. */}
      <NotificationToast items={notifications} />

      {/* ── Masaüstü omurgası (≥1280) ───────────────────────────────
          `header` landmark'ı: masaüstünde uygulamanın başlık bölgesi budur
          (§10). Bağlam çubuğu `display:none` olduğu için erişilebilirlik
          ağacında aynı anda iki banner bulunmaz. */}
      <header className="fixed inset-y-0 start-0 z-[var(--z-spine)] hidden w-(--spacing-spine) flex-col border-e border-line bg-raised xl:flex">
        {/* Marka kendi satırında ve tek başına. Zil buradan alındı: bildirim
            gelince rozetle birlikte markayı sıkıştırıyor, alanı
            karıştırıyordu. Yeri artık hesap satırı — kişisel olan her şey
            omurganın altında toplanıyor. */}
        <div className="flex min-h-16 items-center border-b border-line px-4 py-3">
          <Brand brand={brand} />
        </div>

        {/* Birincil eylem, bir yere iliştirilmiş düğme değil **omurganın ilk
            satırı**: tam genişlikte, gezinme satırlarıyla aynı ritimde
            (aynı sol boşluk, aynı ikon-metin aralığı, aynı yükseklik).
            Böylece listenin vurgulu ilk maddesi gibi okunuyor. */}
        {model.primaryAction ? (
          <Link
            href={model.primaryAction.href}
            className="flex min-h-(--spacing-touch) items-center gap-3 border-b border-line bg-primary px-4 py-2.5 text-[length:var(--text-sm)] font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-primary-hover active:bg-primary-pressed"
          >
            <NavIcon name="yeni" className="size-5 shrink-0" />
            {model.primaryAction.label}
          </Link>
        ) : null}

        <nav aria-label="Ana menü" className="flex-1 overflow-y-auto pb-4">
          <NavGroup label="Benim işlerim" items={model.personal} pathname={pathname} />
          <NavGroup label="Yönettiğim alan" items={model.management} pathname={pathname} />
          <NavGroup label="Yardım ve iletişim" items={model.common} pathname={pathname} />
          <NavGroup label="Sistem yönetimi" items={model.admin} pathname={pathname} />
        </nav>

        <div className="flex items-center gap-1 border-t border-line p-2">
          <div className="min-w-0 flex-1">
            <AccountMenu user={user} logout={logout} align="left" />
          </div>
          <NotificationBell
            items={notifications}
            unseen={unseenNotifications}
            onOpen={markNotificationsSeen}
            // Zil omurganın **en altında**: kutu aşağı açılırsa ekran dışına
            // taşar. Hesap menüsüyle aynı sebep, aynı çözüm.
            placement="top"
          />
        </div>
      </header>

      {/* ── Bağlam çubuğu (<1280) ─────────────────────────────────── */}
      <header className="sticky top-0 z-[var(--z-topbar)] flex h-(--spacing-topbar) items-center justify-between gap-2 border-b border-line bg-raised px-3 xl:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Menüyü aç"
            aria-expanded={drawer}
            className="grid size-(--spacing-touch) shrink-0 place-items-center rounded-(--radius-sm) text-muted hover:bg-surface-hover hover:text-ink"
          >
            <NavIcon name="daha" />
          </button>
          <Brand brand={brand} compact />
        </div>

        <div className="flex items-center gap-1">
          <NotificationBell
            items={notifications}
            unseen={unseenNotifications}
            onOpen={markNotificationsSeen}
          />
        </div>
      </header>

      <NavDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        brand={brand}
        user={user}
        logout={logout}
        pathname={pathname}
        personal={model.personal}
        management={model.management}
        common={model.common}
        admin={model.admin}
        primaryAction={model.primaryAction}
      />

      {/* ── Mobil alt gezinme (<768) ──────────────────────────────── */}
      <nav
        aria-label="Birincil gezinme"
        className="fixed inset-x-0 bottom-0 z-[var(--z-tabbar)] flex border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {tabs.map((item) => {
          const aktif = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={aktif ? "page" : undefined}
              className={[
                "relative flex flex-1 flex-col items-center justify-center gap-0.5",
                "min-h-(--spacing-tabbar) px-1 text-[length:var(--text-2xs)]",
                aktif ? "font-semibold text-primary" : "text-muted",
              ].join(" ")}
            >
              {aktif ? (
                <span aria-hidden className="absolute inset-x-3 top-0 h-[2px] bg-primary" />
              ) : null}
              <span className="relative">
                <NavIcon name={item.icon} />
                {item.count ? (
                  <span
                    aria-hidden
                    className="absolute -end-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-(--radius-xs) bg-primary px-0.5 text-[length:var(--text-2xs)] font-semibold text-white tabular"
                  >
                    {item.count > 9 ? "9+" : item.count}
                  </span>
                ) : null}
              </span>
              <span className="truncate">{item.label}</span>
              {item.count ? (
                <span className="sr-only">
                  {item.count} {item.countLabel ?? "bekleyen"}
                </span>
              ) : null}
            </Link>
          );
        })}

        {model.primaryAction ? (
          <Link
            href={model.primaryAction.href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[length:var(--text-2xs)] font-medium text-primary"
          >
            <span className="grid size-7 place-items-center rounded-(--radius-xs) bg-primary text-white">
              <NavIcon name="yeni" className="size-4" />
            </span>
            Yeni
          </Link>
        ) : null}

        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Tüm bölümler"
          aria-expanded={drawer}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[length:var(--text-2xs)] text-muted"
        >
          <NavIcon name="daha" />
          Daha
        </button>
      </nav>
    </>
  );
}
