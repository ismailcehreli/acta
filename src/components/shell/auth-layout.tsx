import type { ReactNode } from "react";

import { prisma } from "@/server/db";
import { readBranding } from "@/server/settings/branding";
import { APP_VERSION } from "@/server/version";

// Oturumsuz ekranların düzeni: giriş ve parola sıfırlama.
//
// **Pazarlama sayfası değil** (brief §7): güven veren, odaklı bir giriş
// yüzeyi. Masaüstünde solda sistemin ne yaptığını anlatan üç madde, sağda
// form; mobilde form doğrudan öncelikli — tanıtım altta ve ikincil.
//
// Kabuk yoktur (gösterilecek kullanıcı yok) ama marka görünür: kullanıcı
// doğru sistemde olduğunu anlamalı.

/**
 * Giriş ekranındaki maddeler.
 *
 * Üç kez yazıldı, üçünde de fazla iddialıydı: önce slogan, sonra yönetmelik,
 * sonra "yaptığınız iş görünsün" — sonuncusu, sanki emeğin görünmediği ya da
 * görünmesinin engellendiği gibi okunabiliyordu ve ürün sahibi haklı olarak
 * itiraz etti.
 *
 * Bu ekranı şirketteki herkes görecek. Burada motive etmeye ya da bir şey
 * vaat etmeye çalışmıyoruz: **sistemin ne yaptığını** yazıyoruz. Üç madde,
 * uygulamanın üç işlevi. Abartısız, tarafsız, kısa.
 */
const MANIFESTO = [
  {
    no: "01",
    baslik: "Faaliyet kaydı",
    metin:
      "Gün içinde yürütülen işler, yapılan tespitler ve karşılaşılan sorunlar kısa kayıtlar hâlinde girilir.",
  },
  {
    no: "02",
    baslik: "Yönetici değerlendirmesi",
    metin:
      "Kayıt, bağlı olunan yöneticiye iletilir. Yönetici onaylar, düzeltme ister ya da gerekçesiyle uygun bulmaz.",
  },
  {
    no: "03",
    baslik: "Soru ve takip",
    metin:
      "Bir kayıt üzerine soru sorulabilir veya takip maddesi açılabilir. Konu kapanana kadar ilgili kişilerin listesinde kalır.",
  },
];

export async function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const brand = await readBranding(prisma);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,44%)]">
      {/* ── Manifesto (masaüstünde solda, mobilde altta) ───────────── */}
      <aside
        aria-label="Ürün tanıtımı"
        className="order-2 hidden border-t border-line bg-raised px-6 py-10 sm:block lg:order-1 lg:flex lg:flex-col lg:justify-between lg:border-t-0 lg:border-e lg:px-12 lg:py-14"
      >
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <span className="section-label">Faaliyet Raporlama Sistemi</span>
          <p className="mt-4 text-[length:var(--text-xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance text-ink lg:text-[length:var(--text-3xl)]">
            Günlük faaliyet kaydı, onay ve takip.
          </p>
          <p className="prose-measure mt-4 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
            Şirket içi kullanım içindir. Çalışanlar gün içindeki işlerini
            kaydeder, yöneticiler değerlendirir, açık konular kapanana kadar
            izlenir.
          </p>

          <ol className="mt-10 flex flex-col gap-7">
            {MANIFESTO.map((madde) => (
              <li key={madde.no} className="flex gap-4">
                <span className="mono mt-0.5 shrink-0 text-[length:var(--text-xs)] text-faint">
                  {madde.no}
                </span>
                <span className="border-s border-line ps-4">
                  <span className="block text-[length:var(--text-sm)] font-semibold text-ink">
                    {madde.baslik}
                  </span>
                  <span className="prose-measure mt-1 block text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                    {madde.metin}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="mx-auto mt-12 flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-2xs)] text-faint lg:mx-0 lg:mt-0">
          <span>
            © {new Date().getFullYear()} {brand.footerText}. Tüm hakları
            saklıdır.
          </span>
          {APP_VERSION ? <span className="mono">Sürüm {APP_VERSION}</span> : null}
        </p>
      </aside>

      {/* ── Form ────────────────────────────────────────────────────
          Mobilde ilk sırada: kullanıcı buraya giriş yapmaya gelir. */}
      <main
        id="icerik"
        className="order-1 flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-8 lg:order-2 lg:min-h-0 lg:px-14"
      >
        <div className="mx-auto w-full max-w-[400px]">
          <div className="flex flex-col gap-6">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.pageTitle}
                className="h-11 w-auto max-w-52 object-contain"
              />
            ) : (
              <span className="text-[length:var(--text-lg)] font-semibold tracking-[var(--tracking-tight)] text-ink">
                {brand.pageTitle}
              </span>
            )}

            <div>
              <h1 className="text-[length:var(--text-2xl)] font-semibold text-ink">
                {title}
              </h1>
              {description ? (
                <p className="mt-2 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
                  {description}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-8">{children}</div>

          {footer ? (
            <div className="mt-7 border-t border-line pt-5 text-[length:var(--text-sm)]">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
