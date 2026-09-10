import type { Metadata } from "next";

import { prisma } from "@/server/db";
import { DEFAULT_PAGE_TITLE, readBranding } from "@/server/settings/branding";
import { getLocale } from "@/server/i18n/locale";
import { getTranslations } from "@/server/i18n/server";
import { I18nProvider } from "@/components/i18n/provider";

import "./globals.css";

/**
 * Sekme başlığı **ayardan** gelir (ürün sahibi kararı, 19.08.2026). Sabit
 * yazılı olduğu sürece marka ayarı yarım kalıyordu: logo değişiyor, sekmede
 * hâlâ varsayılan ad duruyordu.
 *
 * **Veritabanına ulaşılamazsa varsayılan başlıkla devam edilir.** İki gerçek
 * durum var:
 *
 * 1. **Derleme anı.** Next `/_not-found` sayfasını statik üretmeye çalışıyor
 *    ve o sırada `DATABASE_URL` yok. Docker imajı bu yüzden derlenemiyordu
 *    (19.08.2026'da sunucu kurulumunda yakalandı).
 * 2. **Veritabanı düştüğünde.** Sekme başlığı yüzünden hata sayfasının kendisi
 *    de çizilememeliydi; kullanıcı boş ekran görürdü.
 *
 * Hata **yutulmuyor**, günlüğe yazılıyor: sessiz kalmak, yanlış başlığın
 * sebebini görünmez kılardı.
 */
export async function generateMetadata(): Promise<Metadata> {
  let pageTitle = DEFAULT_PAGE_TITLE;

  try {
    pageTitle = (await readBranding(prisma)).pageTitle;
  } catch (error) {
    console.error(
      "[marka] Sayfa başlığı okunamadı, varsayılan kullanılıyor:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    title: { default: pageTitle, template: `%s · ${pageTitle}` },
    description: "Günlük faaliyet raporlama ve takip sistemi",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations(locale);

  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          {/* Keyboard navigation skip link */}
          <a
            href="#icerik"
            className="sr-only-focusable absolute start-3 top-3 z-[var(--z-toast)] rounded-(--radius-sm) bg-ink px-3 py-2 text-[length:var(--text-sm)] font-medium text-surface"
          >
            {t("common.skipToContent")}
          </a>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
