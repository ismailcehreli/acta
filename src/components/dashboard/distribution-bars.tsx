"use client";

import Link from "next/link";
import { useLocale } from "@/components/i18n/provider";
import { formatNumber, formatPercentage } from "@/shared/format/locale";


//



//



export interface DistributionRow {
  key: string;
  label: string;
  count: number;

  hint?: string;

  href?: string;

  tone?: "primary" | "success" | "waiting" | "correction" | "danger" | "cancelled";
}

const TONE_CLASSES: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  waiting: "bg-waiting",
  correction: "bg-correction",
  danger: "bg-danger",
  cancelled: "bg-line-strong",
};

export function DistributionBars({
  rows,
  emptyText,
}: {
  rows: DistributionRow[];
  emptyText: string;
}) {
  const locale = useLocale();
  const total = rows.reduce((acc, row) => acc + row.count, 0);

  if (total === 0) {
    return (
      <p className="py-6 text-[length:var(--text-sm)] text-muted">{emptyText}</p>
    );
  }

  const maxCount = Math.max(...rows.map((row) => row.count));

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const percentage = Math.round((row.count / total) * 100);
        const content = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[length:var(--text-sm)] text-ink">
                {row.label}
                {row.hint ? (
                  <span className="ms-2 text-[length:var(--text-xs)] text-faint">
                    {row.hint}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[length:var(--text-sm)] text-muted">
                <span className="tabular font-semibold text-ink">{formatNumber(row.count, locale)}</span>
                <span className="ms-1.5 tabular text-faint">{formatPercentage(percentage, locale)}</span>
              </span>
            </span>
            <span
              aria-hidden
              className="mt-1 block h-1.5 bg-inset"
            >
              <span
                className={`block h-full ${TONE_CLASSES[row.tone ?? ""] ?? "bg-line-strong"}`}
                style={{ width: `${Math.max(2, (row.count / maxCount) * 100)}%` }}
              />
            </span>
          </>
        );

        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="block rounded-(--radius-xs) py-0.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
              >
                {content}
              </Link>
            ) : (
              <div className="py-0.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
