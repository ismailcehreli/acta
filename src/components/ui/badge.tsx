import type { ReactNode } from "react";

// Durum işareti (§9).
//
// **Durum hiçbir zaman yalnız renkle anlatılmaz.** Her işaret üç taşıyıcı
// kullanır: bir ikon şekli, bir metin ve bir renk. Renk körü bir kullanıcı,
// siyah beyaz çıktı ya da düşük kontrastlı ekran durumu yine okuyabilmeli.
//
// Şekil dili köşeli: rozet hap değil dikdörtgendir (2px yarıçap). Durumu
// şekil değil metin taşır; hap biçimi yalnız görsel gürültü eklerdi.

export type BadgeTone =
  | "neutral"
  | "primary"
  | "info"
  | "success"
  | "waiting"
  | "correction"
  | "danger"
  | "cancelled";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-inset text-muted border-line",
  primary: "bg-primary-soft text-primary border-primary-line",
  info: "bg-info-soft text-info border-info-line",
  success: "bg-success-soft text-success border-success-line",
  waiting: "bg-waiting-soft text-waiting border-waiting-line",
  correction: "bg-correction-soft text-correction border-correction-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  cancelled: "bg-cancelled-soft text-cancelled border-cancelled-line",
};

/**
 * Duruma ait ikon. Renkten bağımsız ikinci taşıyıcı: her ton kendi
 * şeklini kullanır, böylece iki durum gri tonlamada bile ayrışır.
 */
function ToneIcon({ tone }: { tone: BadgeTone }) {
  const ortak = { width: 11, height: 11, viewBox: "0 0 12 12", "aria-hidden": true } as const;

  switch (tone) {
    case "success":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="square" />
        </svg>
      );
    case "waiting":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="6" cy="6" r="4.6" />
          <path d="M6 3.4V6l1.8 1.2" strokeLinecap="square" />
        </svg>
      );
    case "correction":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 1.6 11 10.4H1L6 1.6Z" strokeLinejoin="miter" />
          <path d="M6 5v2.2M6 8.8v.4" strokeLinecap="square" />
        </svg>
      );
    case "danger":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.6 2.6 9.4 9.4M9.4 2.6 2.6 9.4" strokeLinecap="square" />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="6" cy="6" r="4.6" />
          <path d="M2.9 9.1 9.1 2.9" strokeLinecap="square" />
        </svg>
      );
    case "info":
    case "primary":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 5.4v4M6 2.8v.6" strokeLinecap="square" />
        </svg>
      );
    case "neutral":
      return (
        <svg {...ortak} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.4 6h7.2" strokeLinecap="square" />
        </svg>
      );
  }
}

export function Badge({
  tone = "neutral",
  children,
  icon = true,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  /** İkon gizlenebilir; yalnız metnin zaten durumu taşıdığı yerlerde. */
  icon?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-(--radius-xs) border px-1.5 py-0.5 text-[length:var(--text-xs)] leading-[var(--leading-tight)] font-medium ${TONES[tone]} ${className ?? ""}`}
    >
      {icon ? <ToneIcon tone={tone} /> : null}
      {children}
    </span>
  );
}

/**
 * Okunmamış işareti (§10.1).
 *
 * Nokta **tek başına yeterli değil** (brief §6): işaretin ekran okuyucu
 * metni ve görsel ikinci taşıyıcısı (dolu/boş kare) vardır.
 */
export function ReadDot({ read }: { read: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={
          read
            ? "mt-[7px] size-2 shrink-0 border border-line-strong"
            : "mt-[7px] size-2 shrink-0 bg-primary"
        }
      />
      <span className="sr-only">{read ? "Okundu" : "Okunmadı"}</span>
    </>
  );
}
