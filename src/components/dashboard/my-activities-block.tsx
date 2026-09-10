import Link from "next/link";

// Bugünkü kaydınız (brief §6).
//
// **Kart değil şerit.** Ana ekranın en güçlü bölümü kişiye düşen iştir;
// kendi kayıt sayısı onun altında, sakin ve ince bir şeritte durur. Dev bir
// metrik kartı burada işi gölgelerdi.
//
// Sıfır kayıt durumu **suçlayıcı değil yönlendiricidir**: "0 kayıt" diye bir
// sayı basılmaz, ne yapılacağı yazılır.

export function MyActivitiesBlock({
  todayCount,
  totalCount,
}: {
  todayCount: number;
  totalCount: number;
}) {
  return (
    <section
      aria-labelledby="bugunku-kaydiniz"
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-y border-line bg-raised px-4 py-4 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-5">
        <span className="section-label" id="bugunku-kaydiniz">
          Bugünkü kaydınız
        </span>

        {todayCount === 0 ? (
          // Sayfa başlığı zaten "bugün henüz faaliyet girmediniz" diyor; aynı
          // cümleyi tek ekranda iki kez yazmak bilgi katmıyordu. Şerit
          // durumu değil **eylemi** taşır (Görev 11.1).
          <p className="text-[length:var(--text-sm)] text-muted">
            Günü kapatmadan önce bugün ne yaptığınızı bırakın.
          </p>
        ) : (
          <p className="flex items-baseline gap-2 text-[length:var(--text-sm)] text-muted">
            <span className="mono text-[length:var(--text-xl)] font-semibold text-ink">
              {todayCount}
            </span>
            <span>kayıt girdiniz</span>
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <span>
              toplam <span className="mono text-ink">{totalCount}</span>
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Link
          href="/activities"
          className="text-[length:var(--text-sm)] text-muted hover:text-ink hover:underline"
        >
          Faaliyetlerim
        </Link>
        <Link
          href="/activities/new"
          className="inline-flex min-h-(--spacing-control) items-center gap-2 rounded-(--radius-sm) bg-primary px-4 text-[length:var(--text-sm)] font-medium text-white transition-colors duration-(--duration-fast) hover:bg-primary-hover active:bg-primary-pressed"
        >
          Yeni faaliyet
        </Link>
      </div>
    </section>
  );
}
