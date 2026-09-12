"use client";

import type { ReactNode } from "react";
import { useTranslations } from "@/components/i18n/provider";


//



//




export type AlertTone = "info" | "success" | "waiting" | "correction" | "danger";

const TONES: Record<AlertTone, { surface: string; borderClass: string; iconClass: string }> = {
  info: { surface: "bg-info-soft", borderClass: "border-info", iconClass: "text-info" },
  success: { surface: "bg-success-soft", borderClass: "border-success", iconClass: "text-success" },
  waiting: { surface: "bg-waiting-soft", borderClass: "border-waiting", iconClass: "text-waiting" },
  correction: {
    surface: "bg-correction-soft",
    borderClass: "border-correction",
    iconClass: "text-correction",
  },
  danger: { surface: "bg-danger-soft", borderClass: "border-danger", iconClass: "text-danger" },
};

function AlertIcon({ tone }: { tone: AlertTone }) {
  const shared = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    "aria-hidden": true,
  } as const;

  if (tone === "success") {
    return (
      <svg {...shared}>
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg {...shared}>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "correction") {
    return (
      <svg {...shared}>
        <path d="M8 2 15 14H1L8 2Z" strokeLinejoin="miter" />
        <path d="M8 6.6v3M8 11.4v.5" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "waiting") {
    return (
      <svg {...shared}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.6V8l2.4 1.6" strokeLinecap="square" />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <path d="M8 7v5M8 4v.7" strokeLinecap="square" />
      <circle cx="8" cy="8" r="6.2" />
    </svg>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;

  action?: ReactNode;
}) {
  const style = TONES[tone];

  return (
    <div
      role={tone === "danger" || tone === "correction" ? "alert" : "status"}
      className={`flex items-start gap-3 border-s-[3px] ${style.borderClass} ${style.surface} px-3.5 py-3`}
    >
      <span className={`mt-px shrink-0 ${style.iconClass}`}>
        <AlertIcon tone={tone} />
      </span>

      <div className="min-w-0 flex-1">
        {title ? (
          <p className="text-[length:var(--text-sm)] font-semibold text-ink">
            {title}
          </p>
        ) : null}
        {children ? (
          <div
            className={`text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-ink ${title ? "mt-0.5" : ""}`}
          >
            {children}
          </div>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Render a form result; empty results render nothing. */
export function FormMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  const t = useTranslations();
  if (error) {
    return (
      <Alert tone="danger" title={t("common.operationFailed")}>
        {error}
      </Alert>
    );
  }
  if (success) return <Alert tone="success">{success}</Alert>;
  return null;
}
