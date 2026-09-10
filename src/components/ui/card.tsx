import type { ReactNode } from "react";

// Bölüm yüzeyi.
//
// **Kart değil bölüm.** Bu sistemde paneller yuvarlak köşeli gölgeli kutular
// değil; kural çizgisiyle çevrelenmiş, köşeli, düz yüzeylerdir. Gölge yalnız
// gerçekten üstte duran katmanlara (menü, dialog, sheet) ayrılmıştır.
//
// Ad `Card` olarak korundu: kırk dosya bu adı kullanıyor ve adlandırma
// değişikliği tasarım işine görünmez bir göç riski eklerdi.

export function Card({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`border border-line bg-surface ${className ?? ""}`}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * Bölüm başlığı. Sol tarafta bölüm numarası/etiketi yerini alan ince bir
 * dikey işaret, sonra başlık; sağda tek eylem.
 */
export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-[length:var(--text-lg)] font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-4 sm:px-5 ${className ?? ""}`}>{children}</div>;
}

/**
 * Boş durum. Dev bir illüstrasyon ya da kutu değil: sakin bir metin bloğu ve
 * varsa tek bir yönlendirici eylem (§3 — dekoratif illüstrasyon yok).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-9 sm:px-5">
      <span aria-hidden className="h-px w-10 bg-line-strong" />
      <h2 className="text-[length:var(--text-base)] font-medium text-ink">
        {title}
      </h2>
      {description ? (
        <p className="text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
