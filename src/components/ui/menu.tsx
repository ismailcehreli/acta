"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";





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

  placement?: "bottom" | "top";

  label: string;

  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen((previous) => {
            if (!previous) onOpen?.();
            return !previous;
          });
        }}
        className="flex items-center gap-2 rounded-(--radius-sm) px-2 py-1.5 text-[length:var(--text-sm)] transition-colors hover:bg-inset"
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="menu"


          // Defer closing so the clicked menu item can finish its action.
          onClick={() => setTimeout(() => setOpen(false), 0)}
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

/** Menu item that submits a form, such as the log-out action. */
export function MenuSubmit({ children }: { children: ReactNode }) {
  return (
    <button type="submit" role="menuitem" className={ITEM}>
      {children}
    </button>
  );
}
