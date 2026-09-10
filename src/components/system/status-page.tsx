import type { ReactNode } from "react";

// Sistem durumu yüzeyleri (Görev 10.1): yükleniyor, hata, bulunamadı.
//
// Bunlar **kabuğun dışında** çizilir. Sebebi: kabuk oturumu, markayı ve
// okunmamış sayısını veritabanından okuyor. Hata sayfası veritabanı çöktüğü
// için gösteriliyorsa, kabuğu çizmeye çalışmak aynı hataya ikinci kez
// düşmek olurdu — kullanıcı hata sayfası yerine boş ekran görürdü.
//
// Bu yüzden burada dış bağımlılık yok: yalnız metin, ikon ve bağlantı.
//
// Tasarım kararı (brief §8): hata yüzeyi özür dileyen bir illüstrasyon
// değil, **bir bildirim**. Ortalanmış daire-ikon-nokta düzeni yerine sola
// hizalı editoryal blok: kenar işareti, durum etiketi, başlık, ne yapılacağı.
// Aynı sistemin diğer ekranlarıyla aynı dili konuşur; kullanıcı başka bir
// uygulamaya düşmüş hissetmez.

export function StatusPage({
  icon,
  title,
  description,
  detail,
  actions,
  /** Durum etiketi; sayfanın ne tür bir yüzey olduğunu tek kelimeyle söyler. */
  marker = "Durum",
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  /** Teknik ayrıntı; kullanıcının okuması gerekmez ama destek için lazım. */
  detail?: ReactNode;
  actions?: ReactNode;
  marker?: string;
  tone?: "neutral" | "danger";
}) {
  // `data-durum-yuzeyi`: hata, "bulunamadı" ve yükleniyor yüzeyleri de `main`
  // çiziyor ve kabul ölçümü yalnız `main` bekliyordu; o zaman hataya düşmüş
  // bir sayfa da başarılı ölçüm sayılabiliyordu (denetim 23.08.2026,
  // bulgu 10). Ölçüm artık bu işaretin **yokluğunu** arıyor.
  return (
    <main
      data-durum-yuzeyi={marker}
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12"
    >
      <div className="relative ps-5">
        {/* Kenar işareti: renk tek taşıyıcı değil, konum da anlam taşıyor. */}
        <span
          aria-hidden
          className={`absolute inset-y-0 start-0 w-[3px] ${
            tone === "danger" ? "bg-danger" : "bg-line-strong"
          }`}
        />

        <p className="section-label flex items-center gap-2">
          <span className={tone === "danger" ? "text-danger" : "text-faint"}>{icon}</span>
          {marker}
        </p>

        <h1 className="mt-2 text-[length:var(--text-2xl)] font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="prose-measure mt-2 text-[length:var(--text-base)] leading-[var(--leading-relaxed)] text-muted">
          {description}
        </p>

        {actions ? <div className="mt-6 flex flex-wrap gap-2">{actions}</div> : null}

        {detail ? (
          <p className="mono mt-6 border-t border-line pt-3 text-[length:var(--text-xs)] text-faint">
            {detail}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** Yükleniyor göstergesi. Hareket, "durdu mu?" sorusunu ortadan kaldırır. */
export function Spinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-3 text-muted"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-6 animate-spin text-primary"
        fill="none"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[length:var(--text-sm)]">{label}</span>
    </div>
  );
}

export function UyariIkonu() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 8.5v4.5" strokeLinecap="round" />
      <path d="M12 16.5h.01" strokeLinecap="round" />
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
    </svg>
  );
}

export function BulunamadiIkonu() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" strokeLinecap="round" />
    </svg>
  );
}

export function BaglantiIkonu() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path d="M8.5 8.5a5 5 0 0 0-1.4 1 4 4 0 0 0 2.8 6.8h2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 7.7h2.2a4 4 0 0 1 3.2 6.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
