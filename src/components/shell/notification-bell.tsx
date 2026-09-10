"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Menu, MenuHeader, MenuSeparator } from "@/components/ui/menu";

// Zil ve anlık kutucuk (Görev 10.4).
//
// Veri **sunucudan geliyor**: kabuk her tazelemede bildirim listesini yeniden
// üretiyor ve gerçek zamanlı akış (Görev 7.3) zaten tazeliyor. Bu yüzden burada
// ayrı bir istek yok; ekranı süren tek bir yol var.
//
// Gerçek zamanlı olaylar **içerik taşımıyor** (bilerek — akış görünürlük
// modülünden geçmez). Kutucuktaki metin bu yüzden akıştan değil, sunucunun
// ürettiği listeden geliyor; o liste normal denetimlerden geçmiş oluyor.

export interface BellItem {
  id: string;
  summary: string;
  /** İlgili faaliyetin sıra numarası; hangi kayıt olduğunu ayırt ettirir. */
  activityNo: number | null;
  path: string;
  /** "3 dk önce" gibi hazır metin; sunucuda üretilir. */
  age: string;
  seen: boolean;
}

function ZilIkonu() {
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

/**
 * Anlık kutucuk. Yeni bir bildirim geldiğinde birkaç saniye görünür.
 *
 * "Yeni" ölçütü listenin **en üstteki kimliğinin değişmesi**. Sayının artmasına
 * bakmak yanlış olurdu: kullanıcı bir bildirimi okuyup sayıyı düşürdükten sonra
 * gelen yeni bildirim sayıyı eski değerine geri getirir ve fark edilmezdi.
 */
function Toast({ item, onClose }: { item: BellItem | null; onClose: () => void }) {
  if (!item) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-test="bildirim-kutucugu"
      className="fixed bottom-4 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-(--radius-md) border border-line-strong bg-surface p-3.5 shadow-(--shadow-dialog) sm:left-auto sm:right-4 sm:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-primary">
          <ZilIkonu />
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
          aria-label="Bildirimi kapat"
          className="shrink-0 rounded-(--radius-sm) px-1.5 text-muted hover:bg-surface-hover hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const KUTUCUK_SURESI_MS = 8000;

/**
 * Anlık kutucuk — sayfada **tek** monte edilir.
 *
 * Zil iki kırılım noktasında iki kez render ediliyor (masaüstü omurgası ve
 * bağlam çubuğu; biri her zaman gizli). Kutucuk zilin içinde kalsaydı iki kez
 * monte olur ve aynı bildirim iki kez belirirdi.
 */
export function NotificationToast({ items }: { items: BellItem[] }) {
  const enUsttekiId = items[0]?.id ?? null;
  const [kutucuk, setKutucuk] = useState<BellItem | null>(null);
  // İlk açılışta kutucuk gösterilmez: sayfaya yeni giren kişiye eski bir
  // bildirimi "az önce geldi" gibi sunmak yanlış olurdu.
  const gorulenEnUst = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (gorulenEnUst.current === undefined) {
      gorulenEnUst.current = enUsttekiId;
      return;
    }

    if (enUsttekiId === null || enUsttekiId === gorulenEnUst.current) return;

    gorulenEnUst.current = enUsttekiId;
    const yeni = items[0];
    if (!yeni || yeni.seen) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKutucuk(yeni);
    const zamanlayici = setTimeout(() => setKutucuk(null), KUTUCUK_SURESI_MS);
    return () => clearTimeout(zamanlayici);
  }, [enUsttekiId, items]);

  return <Toast item={kutucuk} onClose={() => setKutucuk(null)} />;
}

export function NotificationBell({
  items,
  unseen,
  onOpen,
  placement = "bottom",
}: {
  items: BellItem[];
  unseen: number;
  /** Kutu açılınca hepsini görüldü işaretleyen sunucu eylemi. */
  onOpen: () => Promise<void>;
  /**
   * Kutunun açılma yönü.
   *
   * Omurganın **altındaki** zil aşağı açılırsa kutu ekranın dışına taşar ve
   * kullanıcı hiçbir şey göremez — 21.08.2026'da tam olarak bu yaşandı:
   * bildirimler vardı, kutu açılıyordu ama ekranın altında kalıyordu. Hesap
   * menüsünde aynı hata daha önce görülüp düzeltilmişti; zile uygulanmamıştı.
   */
  placement?: "bottom" | "top";
}) {
  return (
    <>
      <Menu
        label="Bildirimler"
        placement={placement}
        onOpen={() => {
          if (unseen > 0) void onOpen();
        }}
        trigger={
          // Rozet zilin **üstüne binmez**: sayı ikonu kapatınca ne rozet
          // okunuyor ne ikon tanınıyor. Sarmalayıcıya sağ-üstte boşluk
          // bırakılıyor, rozet o boşluğa oturuyor ve zemin renginde bir
          // halkayla ikondan ayrılıyor.
          <span className="relative inline-flex pt-1.5 pr-2.5 text-muted">
            <ZilIkonu />
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
        {/* Başlık **listede ne olduğunu** söyler.
            Önce yalnız "yeni" sayısına bakıyordu ve dört bildirim
            listelenirken "Yeni bildirim yok" yazıyordu — okuyan, kutunun boş
            olduğunu sanıyordu. Üç ayrı durum var ve üçü ayrı yazılmalı. */}
        <MenuHeader>
          <span className="block font-medium text-ink">Bildirimler</span>
          <span className="block">
            {items.length === 0
              ? "Kutunuz boş"
              : unseen > 0
                ? `${unseen} yeni · toplam ${items.length}`
                : `${items.length} bildirim · yenisi yok`}
          </span>
        </MenuHeader>

        <MenuSeparator />

        {items.length === 0 ? (
          <div className="px-3 py-5">
            <p className="text-[length:var(--text-sm)] font-medium text-ink">
              Henüz bildiriminiz yok.
            </p>
            <p className="mt-1 text-[length:var(--text-xs)] leading-[var(--leading-normal)] text-muted">
              Size soru sorulduğunda, onayınız beklendiğinde ya da bir kaydınız
              karara bağlandığında burada görünür.
            </p>
          </div>
        ) : (
          <div
            className="max-h-96 overflow-y-auto"
            data-test="bildirim-listesi"
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
                  {/* Numara olmadan aynı metin üst üste tekrarlanıyor ve
                      hangi kayıt olduğu anlaşılmıyordu. */}
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
