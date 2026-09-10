"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Açılır menü. Dışarı tıklayınca ve Esc ile kapanır; klavyeyle gezilebilir.
// `details/summary` ile de yapılabilirdi ama o dışarı tıklamayı yakalamıyor ve
// menü açık kalıyordu.

export function Menu({
  trigger,
  children,
  align = "right",
  placement = "bottom",
  label,
  onOpen,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /**
   * Menünün açılma yönü. Omurganın **altındaki** hesap menüsü aşağı
   * açılırsa ekran dışına taşar ve tıklanamaz olur; orada "top" kullanılır.
   */
  placement?: "bottom" | "top";
  /** Ekran okuyucu için düğmenin adı. */
  label: string;
  /** Menü **açılırken** bir kez çağrılır; kapanırken çağrılmaz. */
  onOpen?: () => void;
}) {
  const [acik, setAcik] = useState(false);
  const kok = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acik) return;

    function disariTiklama(event: MouseEvent) {
      if (!kok.current?.contains(event.target as Node)) setAcik(false);
    }
    function escBasildi(event: KeyboardEvent) {
      if (event.key === "Escape") setAcik(false);
    }

    document.addEventListener("mousedown", disariTiklama);
    document.addEventListener("keydown", escBasildi);
    return () => {
      document.removeEventListener("mousedown", disariTiklama);
      document.removeEventListener("keydown", escBasildi);
    };
  }, [acik]);

  return (
    <div ref={kok} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={acik}
        aria-label={label}
        onClick={() => {
          setAcik((onceki) => {
            if (!onceki) onOpen?.();
            return !onceki;
          });
        }}
        className="flex items-center gap-2 rounded-(--radius-sm) px-2 py-1.5 text-[length:var(--text-sm)] transition-colors hover:bg-inset"
      >
        {trigger}
      </button>

      {acik ? (
        <div
          role="menu"
          // Kapanma bir tur ertelenir: menü öğesi bir form gönderiyorsa
          // (çıkış gibi) hemen kapatmak formu DOM'dan kaldırıp gönderimi
          // iptal ediyordu.
          onClick={() => setTimeout(() => setAcik(false), 0)}
          className={`absolute z-[var(--z-menu)] min-w-56 overflow-hidden rounded-(--radius-sm) border border-line bg-surface py-1 shadow-(--shadow-menu) ${
            align === "right" ? "end-0" : "start-0"
          } ${placement === "top" ? "bottom-full mb-1.5" : "mt-1.5"}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-2 text-[length:var(--text-xs)] text-muted">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-line" />;
}

const ITEM =
  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[length:var(--text-sm)] text-ink transition-colors hover:bg-surface-hover";

/** Form gönderen menü öğesi (çıkış gibi). */
export function MenuSubmit({ children }: { children: ReactNode }) {
  return (
    <button type="submit" role="menuitem" className={ITEM}>
      {children}
    </button>
  );
}
