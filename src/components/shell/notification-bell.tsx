"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Menu, MenuHeader, MenuSeparator } from "@/components/ui/menu";


//
// Data comes from the server: the shell reloads the notification list on each


//




export interface BellItem {
  id: string;
  summary: string;

  activityNo: number | null;
  path: string;

  age: string;
  seen: boolean;
}

function BellIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path
        d="M18 8.5a6 6 0 1 0-12 0c0 4.2-1.2 5.6-1.9 6.3-.4.4-.1 1.2.5 1.2h14.8c.6 0 .9-.8.5-1.2-.7-.7-1.9-2.1-1.9-6.3Z"
        strokeLinejoin="round"
      />
      <path d="M10 19.5a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}


function Toast({ item, onClose }: { item: BellItem | null; onClose: () => void }) {
  const t = useTranslations();
  if (!item) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-test="notification-toast"
      className="fixed bottom-4 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-(--radius-md) border border-line-strong bg-surface p-3.5 shadow-(--shadow-dialog) sm:left-auto sm:right-4 sm:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-primary">
          <BellIcon />
        </span>
        <Link
          href={item.path}
          onClick={onClose}
          className="min-w-0 flex-1 text-[length:var(--text-sm)] text-ink hover:underline"
        >
          {item.summary}
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("notifications.close")}
          className="shrink-0 rounded-(--radius-sm) px-1.5 text-muted hover:bg-surface-hover hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const TOAST_DURATION_MS = 8000;


export function NotificationToast({ items }: { items: BellItem[] }) {
  const topItemId = items[0]?.id ?? null;
  const [toastItem, setToastItem] = useState<BellItem | null>(null);
  const lastSeenTopItemId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastSeenTopItemId.current === undefined) {
      lastSeenTopItemId.current = topItemId;
      return;
    }

    if (topItemId === null || topItemId === lastSeenTopItemId.current) return;

    lastSeenTopItemId.current = topItemId;
    const next = items[0];
    if (!next || next.seen) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToastItem(next);
    const timer = setTimeout(() => setToastItem(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [topItemId, items]);

  return <Toast item={toastItem} onClose={() => setToastItem(null)} />;
}

export function NotificationBell({
  items,
  unseen,
  onOpen,
  placement = "bottom",
}: {
  items: BellItem[];
  unseen: number;

  onOpen: () => Promise<void>;

  placement?: "bottom" | "top";
}) {
  const t = useTranslations();
  return (
    <>
      <Menu
        label={t("notifications.title")}
        placement={placement}
        onOpen={() => {
          if (unseen > 0) void onOpen();
        }}
        trigger={




          <span className="relative inline-flex pt-1.5 pr-2.5 text-muted">
            <BellIcon />
            {unseen > 0 ? (
              <span
                className="absolute top-0 right-0 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-waiting px-[3px] text-[9px] leading-none font-semibold text-white ring-2 ring-raised tabular"
                aria-hidden
              >
                {unseen > 9 ? "9+" : unseen}
              </span>
            ) : null}
          </span>
        }
      >

        <MenuHeader>
          <span className="block font-medium text-ink">{t("notifications.title")}</span>
          <span className="block">
            {items.length === 0
              ? t("notifications.inboxEmpty")
              : unseen > 0
                ? t("notifications.unreadSummary", { unread: unseen, total: items.length })
                : t("notifications.allReadSummary", { total: items.length })}
          </span>
        </MenuHeader>

        <MenuSeparator />

        {items.length === 0 ? (
          <div className="px-3 py-5">
            <p className="text-[length:var(--text-sm)] font-medium text-ink">
              {t("notifications.emptyTitle")}
            </p>
            <p className="mt-1 text-[length:var(--text-xs)] leading-[var(--leading-normal)] text-muted">
              {t("notifications.emptyDescription")}
            </p>
          </div>
        ) : (
          <div
            className="max-h-96 overflow-y-auto"
            data-test="notification-list"
          >
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.path}
                role="menuitem"
                className={[
                  "flex flex-col gap-0.5 px-3 py-2.5 transition-colors hover:bg-surface-hover",
                  item.seen ? "" : "bg-primary-soft/40",
                ].join(" ")}
              >
                <span className="text-[length:var(--text-sm)] text-ink">
                  {item.summary}
                </span>
                <span className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-muted">
                  {/* The number distinguishes otherwise identical summaries. */}
                  {item.activityNo !== null ? (
                    <>
                      <span className="mono text-faint">#{item.activityNo}</span>
                      <span aria-hidden className="text-line-strong">·</span>
                    </>
                  ) : null}
                  <span>{item.age}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </Menu>
    </>
  );
}
