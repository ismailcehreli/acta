import Link from "next/link";
import type { ReactNode } from "react";

// Sayfa iskeleti — editoryal ritim.
//
// Genişlik içeriğin türüne göre değişir (brief §5): belge ve formlar
// kontrollü satır uzunluğunda, akış ve yönetim tabloları geniş. Sayfa
// başlıkları kutu içinde değil, bir kural çizgisinin üstünde durur.

export function Page({
  children,
  isaret,
}: {
  children: ReactNode;
  /**
   * Rotanın adı, ölçüm ve testler için (denetim 23.08.2026, bulgu 10).
   *
   * Kabul ölçümü süreyi kaydetmeden önce **doğru sayfada** olduğunu
   * doğrulamak zorunda: yalnız `main` beklemek yetmiyordu, çünkü hata ve
   * "bulunamadı" yüzeyleri de `main` çiziyor. O zaman yetkisiz yönlendirme
   * ya da beklenmeyen hata bile hızlı ve başarılı bir ölçüm olarak
   * kaydedilebiliyordu.
   */
  isaret?: string;
}) {
  // **Tek genişlik.** Önce üç ölçü vardı (okuma / liste / tablo) ve sayfa
  // değiştikçe içerik sütunu genişleyip daralıyordu — kullanıcının gözü her
  // geçişte yeniden hizalanmak zorunda kalıyordu. Çerçeve artık her sayfada
  // aynı; okuma ölçüsü çerçeveyi daraltarak değil, içerikte `prose-measure`
  // ve form ızgarasıyla ayarlanıyor.
  return (
    <main
      id="icerik"
      data-sayfa={isaret}
      className="mx-auto flex max-w-[1180px] flex-col gap-(--spacing-section) px-4 pt-6 pb-(--spacing-page) sm:px-7"
    >
      {children}
    </main>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Sayfa yolu. Kullanıcı **nerede olduğunu** ve nereye döneceğini görmeli;
 * tarayıcının geri düğmesine bırakmak yetmez, çünkü sayfaya bağlantıyla da
 * gelinir.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Sayfa yolu">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-xs)] text-faint">
        {items.map((item, index) => {
          const sonuncu = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {item.href && !sonuncu ? (
                <Link href={item.href} className="hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={sonuncu ? "text-muted" : undefined}>{item.label}</span>
              )}
              {sonuncu ? null : (
                <span aria-hidden className="text-line-strong">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Sayfa başlığı. Üstte ince kural çizgisi ve bölüm etiketi, altında büyük
 * editoryal başlık — kayıt defteri sayfasının açılışı gibi.
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
  /** Bölüm etiketi: "FAALİYET", "YÖNETİM" gibi. */
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
        {/* Metin bloğu **kalan genişliği alır** (`flex-1`) ve açıklamaya
            ölçü sınırı konmaz.

            Tipografide gövde metni 65-75 karakterde tutulur; ama buradaki
            açıklama sürekli okunan bir gövde değil, bir kez okunan alt
            satır. Dar ölçüye sıkıştırıldığında geniş ekranda iki-üç satıra
            kırılıyor ve sağ taraf bomboş kalıyordu — ürün sahibi kararı
            (21.08.2026): mevcut genişlik kullanılsın. */}
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

/** Form satırı düzeni: dar ekranda tek sütun, geniş ekranda bölünür. */
export function FormGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const sinif =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return <div className={`grid grid-cols-1 gap-5 ${sinif}`}>{children}</div>;
}

/**
 * Formun alt şeridi. Birincil eylem solda: Türkçe okuma yönünde ilk göze
 * çarpan yer orasıdır ve mobilde başparmağa en yakın.
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
 * Ölçüm şeridi (brief §7 profil): özet değerler **dekoratif kartlara
 * bölünmez**. Tek bir şeritte, dikey kural çizgileriyle ayrılmış tanım
 * listesi olarak durur.
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
  const renk =
    tone === "primary"
      ? "text-primary"
      : tone === "correction"
        ? "text-correction"
        : "text-ink";

  return (
    <div className="flex flex-col gap-1 border-line px-4 py-3.5 not-first:border-s">
      <dt className="section-label">{label}</dt>
      <dd
        className={`mono text-[length:var(--text-xl)] leading-[var(--leading-tight)] font-semibold ${renk}`}
      >
        {value}
      </dd>
      {hint ? (
        <dd className="text-[length:var(--text-xs)] text-faint">{hint}</dd>
      ) : null}
    </div>
  );
}
