import type { ReactNode } from "react";

// Bildirim şeridi (§9).
//
// Kutu değil **şerit**: sol kenarda kalın bir kenar işareti, düz bir yüzey,
// köşeli. Renk tek taşıyıcı değildir — her tonun ikonu ve genellikle bir
// başlığı vardır.
//
// `role` bilinçli seçilir: hata ve uyarı `alert` (ekran okuyucu sözünü keser),
// bilgi ve başarı `status` (kibarca sıraya girer). Her şeye `alert` demek,
// ekran okuyucu kullanıcısını sürekli böler.

export type AlertTone = "info" | "success" | "waiting" | "correction" | "danger";

const TONES: Record<AlertTone, { yuzey: string; kenar: string; ikon: string }> = {
  info: { yuzey: "bg-info-soft", kenar: "border-info", ikon: "text-info" },
  success: { yuzey: "bg-success-soft", kenar: "border-success", ikon: "text-success" },
  waiting: { yuzey: "bg-waiting-soft", kenar: "border-waiting", ikon: "text-waiting" },
  correction: {
    yuzey: "bg-correction-soft",
    kenar: "border-correction",
    ikon: "text-correction",
  },
  danger: { yuzey: "bg-danger-soft", kenar: "border-danger", ikon: "text-danger" },
};

function AlertIcon({ tone }: { tone: AlertTone }) {
  const ortak = {
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
      <svg {...ortak}>
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg {...ortak}>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "correction") {
    return (
      <svg {...ortak}>
        <path d="M8 2 15 14H1L8 2Z" strokeLinejoin="miter" />
        <path d="M8 6.6v3M8 11.4v.5" strokeLinecap="square" />
      </svg>
    );
  }

  if (tone === "waiting") {
    return (
      <svg {...ortak}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.6V8l2.4 1.6" strokeLinecap="square" />
      </svg>
    );
  }

  return (
    <svg {...ortak}>
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
  /** Şeridin sağındaki tek eylem; varsa gerçekten çalışan bir şey olmalı. */
  action?: ReactNode;
}) {
  const stil = TONES[tone];

  return (
    <div
      role={tone === "danger" || tone === "correction" ? "alert" : "status"}
      className={`flex items-start gap-3 border-s-[3px] ${stil.kenar} ${stil.yuzey} px-3.5 py-3`}
    >
      <span className={`mt-px shrink-0 ${stil.ikon}`}>
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

/**
 * Form sonucu. Hata varsa hata, yoksa başarı; ikisi de yoksa hiçbir şey.
 *
 * Hata şeridi `alert` rolüyle gelir ve odaklanabilir: form gönderiminde
 * hata çıktığında ekran okuyucu kullanıcısı sonucu duyar (§10).
 */
export function FormMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (error) {
    return (
      <Alert tone="danger" title="İşlem tamamlanamadı">
        {error}
      </Alert>
    );
  }
  if (success) return <Alert tone="success">{success}</Alert>;
  return null;
}
