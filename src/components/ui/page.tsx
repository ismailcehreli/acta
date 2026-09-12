import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";

// Shared page layout and editorial rhythm.
//




export function Page({
  children,
  marker,
}: {
  children: ReactNode;

  marker?: string;
}) {





  return (
    <main
      id="content"
      data-page={marker}
      className="mx-auto flex max-w-[1180px] flex-col gap-(--spacing-section) px-4 pt-6 pb-(--spacing-page) sm:px-7"
    >
      {children}
    </main>
  );
}

export type { Crumb } from "./breadcrumbs";

/**
 * Page heading with a section marker, rule, title, and optional description.
 */
export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  marker,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Section marker such as "ACTIVITY" or "ADMINISTRATION". */
  marker?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      {marker ? (
        <div className="flex items-center gap-3">
          <span className="section-label">{marker}</span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {/* The text block takes the remaining width so long descriptions do not
            wrap into an unnecessarily narrow column. */}
        <div className="min-w-0 flex-1">
          <h1 className="text-[length:var(--text-2xl)] font-semibold text-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
    </div>
  );
}

/** Form rows use one column on narrow screens and split on wider screens. */
export function FormGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const className =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return <div className={`grid grid-cols-1 gap-5 ${className}`}>{children}</div>;
}

/**
 * Form action row. The primary action appears first and stays close to the
 * thumb on narrow screens.
 */
export function FormActions({
  children,
  message,
}: {
  children: ReactNode;
  message?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-5">
      {message}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * Summary strip for profile metrics (§7); values remain a single grouped list
 * instead of being split into decorative cards.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-4">
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "primary" | "correction";
  hint?: ReactNode;
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "correction"
        ? "text-correction"
        : "text-ink";

  return (
    <div className="flex flex-col gap-1 border-line px-4 py-3.5 not-first:border-s">
      <dt className="section-label">{label}</dt>
      <dd
        className={`mono text-[length:var(--text-xl)] leading-[var(--leading-tight)] font-semibold ${toneClass}`}
      >
        {value}
      </dd>
      {hint ? (
        <dd className="text-[length:var(--text-xs)] text-faint">{hint}</dd>
      ) : null}
    </div>
  );
}
