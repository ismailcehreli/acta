"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Menu, MenuHeader, MenuSeparator, MenuSubmit } from "@/components/ui/menu";
import { useTranslations } from "@/components/i18n/provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

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
import type { Locale } from "@/shared/i18n";


//

//






//


export interface ShellNavUser extends NavUser {
  profileHref: string;
  fullName: string;

  roleLabel: string;

  roleDetail: string;
  initials: string;

  id: string;
  avatarExtension: string | null;
  locale: Locale;
}


function LinkPending() {
  const t = useTranslations();
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label={t("common.loading")}
      className="ms-auto inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
    />
  );
}


function Count({ item }: { item: NavItem }) {
  const t = useTranslations();
  if (!item.count) return null;

  return (
    <span className="ms-auto inline-flex min-w-5 items-center justify-center rounded-(--radius-xs) bg-primary px-1 text-[length:var(--text-2xs)] font-semibold text-white tabular">
      <span aria-hidden>{item.count > 99 ? "99+" : item.count}</span>
      <span className="sr-only">
        {item.count} {item.countLabel ?? t("common.pending")}
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
  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "group relative flex min-h-(--spacing-touch) items-center gap-3 px-3 py-2",
        "text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
        active
          ? "bg-surface font-semibold text-ink"
          : "text-muted hover:bg-surface-hover hover:text-ink",
      ].join(" ")}
    >

      <span
        aria-hidden
        className={
          active
            ? "absolute inset-y-0 start-0 w-[3px] bg-primary"
            : "absolute inset-y-0 start-0 w-[3px] bg-transparent"
        }
      />
      <NavIcon name={item.icon} className={active ? "size-5 shrink-0 text-primary" : "size-5 shrink-0"} />
      <span className="truncate">{item.label}</span>
      <Count item={item} />
      <LinkPending />
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

  //




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
  const t = useTranslations();

  return (
    <Menu
      label={t("nav.accountMenu")}
      align={align}


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
            locale={user.locale}
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
        {t("nav.profile")}
      </Link>

      <Link
        href="/password"
        role="menuitem"
        className="flex min-h-(--spacing-touch) w-full items-center px-3 text-[length:var(--text-sm)] text-ink transition-colors hover:bg-surface-hover"
      >
        {t("nav.changePassword")}
      </Link>

      <MenuSeparator />

      <div className="flex items-center justify-between px-3 py-2 text-[length:var(--text-xs)] text-muted">
        <span>{t("nav.language")}</span>
        <LanguageSwitcher />
      </div>

      <MenuSeparator />

      <form action={logout}>
        <MenuSubmit>{t("nav.logout")}</MenuSubmit>
      </form>
    </Menu>
  );
}


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
  const t = useTranslations();
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const initial = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === initial) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        initial.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] xl:hidden">
      <button
        type="button"
        aria-label={t("nav.closeMenu")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="absolute inset-y-0 start-0 flex w-[min(86vw,320px)] flex-col border-e border-line bg-raised shadow-(--shadow-dialog)"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={headingId} className="sr-only">
            {t("nav.navigation")}
          </h2>
          <Brand brand={brand} compact />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.closeMenu")}
            className="grid size-(--spacing-touch) place-items-center rounded-(--radius-sm) text-muted hover:bg-surface-hover hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="square" />
            </svg>
          </button>
        </div>

        <nav aria-label={t("nav.mainMenu")} className="flex-1 overflow-y-auto pb-4">
          {primaryAction ? (
            <div className="px-3 pt-3">
              <Link
                href={primaryAction.href}
                onClick={onClose}
                className="flex min-h-(--spacing-control-lg) items-center justify-center gap-2 rounded-(--radius-sm) bg-primary px-4 text-[length:var(--text-sm)] font-medium text-white hover:bg-primary-hover"
              >
                <NavIcon name="new" className="size-4" />
                {primaryAction.label}
              </Link>
            </div>
          ) : null}

          <NavGroup label={t("nav.personalGroup")} items={personal} pathname={pathname} onNavigate={onClose} />
          <NavGroup label={t("nav.managementGroup")} items={management} pathname={pathname} onNavigate={onClose} />
          <NavGroup label={t("nav.commonGroup")} items={common} pathname={pathname} onNavigate={onClose} />
          <NavGroup label={t("nav.adminGroup")} items={admin} pathname={pathname} onNavigate={onClose} />
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
  const t = useTranslations();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  const model = buildNav(user, t);
  const tabs = mobileTabs(model);


  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (drawer) setDrawer(false);
  }

  return (
    <>

      <NotificationToast items={notifications} />


      <header className="fixed inset-y-0 start-0 z-[var(--z-spine)] hidden w-(--spacing-spine) flex-col border-e border-line bg-raised xl:flex">

        <div className="flex min-h-16 items-center border-b border-line px-4 py-3">
          <Brand brand={brand} />
        </div>


        {model.primaryAction ? (
          <Link
            href={model.primaryAction.href}
            className="flex min-h-(--spacing-touch) items-center gap-3 border-b border-line bg-primary px-4 py-2.5 text-[length:var(--text-sm)] font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-primary-hover active:bg-primary-pressed"
          >
            <NavIcon name="new" className="size-5 shrink-0" />
            {model.primaryAction.label}
          </Link>
        ) : null}

        <nav aria-label={t("nav.mainMenu")} className="flex-1 overflow-y-auto pb-4">
          <NavGroup label={t("nav.personalGroup")} items={model.personal} pathname={pathname} />
          <NavGroup label={t("nav.managementGroup")} items={model.management} pathname={pathname} />
          <NavGroup label={t("nav.commonGroup")} items={model.common} pathname={pathname} />
          <NavGroup label={t("nav.adminGroup")} items={model.admin} pathname={pathname} />
        </nav>

        <div className="flex items-center gap-1 border-t border-line p-2">
          <div className="min-w-0 flex-1">
            <AccountMenu user={user} logout={logout} align="left" />
          </div>
          <NotificationBell
            items={notifications}
            unseen={unseenNotifications}
            onOpen={markNotificationsSeen}


            placement="top"
          />
        </div>
      </header>


      <header className="sticky top-0 z-[var(--z-topbar)] flex h-(--spacing-topbar) items-center justify-between gap-2 border-b border-line bg-raised px-3 xl:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={t("nav.openMenu")}
            aria-expanded={drawer}
            className="grid size-(--spacing-touch) shrink-0 place-items-center rounded-(--radius-sm) text-muted hover:bg-surface-hover hover:text-ink"
          >
            <NavIcon name="more" />
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

      {/* ── Mobile bottom navigation (<768) ───────────────────────── */}
      <nav
        aria-label={t("nav.primaryNav")}
        className="fixed inset-x-0 bottom-0 z-[var(--z-tabbar)] flex border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "relative flex flex-1 flex-col items-center justify-center gap-0.5",
                "min-h-(--spacing-tabbar) px-1 text-[length:var(--text-2xs)]",
                active ? "font-semibold text-primary" : "text-muted",
              ].join(" ")}
            >
              {active ? (
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
                  {item.count} {item.countLabel ?? t("common.pending")}
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
              <NavIcon name="new" className="size-4" />
            </span>
            {t("nav.new")}
          </Link>
        ) : null}

        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label={t("nav.allSections")}
          aria-expanded={drawer}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[length:var(--text-2xs)] text-muted"
        >
          <NavIcon name="more" />
          {t("nav.more")}
        </button>
      </nav>
    </>
  );
}
