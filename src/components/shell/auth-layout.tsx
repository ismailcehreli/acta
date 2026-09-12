import type { ReactNode } from "react";

import { prisma } from "@/server/db";
import { readBranding } from "@/server/settings/branding";
import { APP_VERSION } from "@/server/version";
import { getTranslations } from "@/server/i18n/server";


//



//




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
  const t = await getTranslations();
  const manifesto = [
    {
      no: "01",
      title: t("auth.manifesto.recordsTitle"),
      text: t("auth.manifesto.recordsText"),
    },
    {
      no: "02",
      title: t("auth.manifesto.reviewTitle"),
      text: t("auth.manifesto.reviewText"),
    },
    {
      no: "03",
      title: t("auth.manifesto.questionsTitle"),
      text: t("auth.manifesto.questionsText"),
    },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,44%)]">

      <aside
        aria-label={t("auth.manifestoLabel")}
        className="order-2 hidden border-t border-line bg-raised px-6 py-10 sm:block lg:order-1 lg:flex lg:flex-col lg:justify-between lg:border-t-0 lg:border-e lg:px-12 lg:py-14"
      >
        <div className="mx-auto w-full max-w-md lg:mx-0">
        <span className="section-label">{t("auth.manifestoLabel")}</span>
          <p className="mt-4 text-[length:var(--text-xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance text-ink lg:text-[length:var(--text-3xl)]">
            {t("auth.manifestoHeading")}
          </p>
          <p className="prose-measure mt-4 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
            {t("auth.manifestoDescription")}
          </p>

          <ol className="mt-10 flex flex-col gap-7">
            {manifesto.map((item) => (
              <li key={item.no} className="flex gap-4">
                <span className="mono mt-0.5 shrink-0 text-[length:var(--text-xs)] text-faint">
                  {item.no}
                </span>
                <span className="border-s border-line ps-4">
                  <span className="block text-[length:var(--text-sm)] font-semibold text-ink">
                    {item.title}
                  </span>
                  <span className="prose-measure mt-1 block text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                    {item.text}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="mx-auto mt-12 flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-2xs)] text-faint lg:mx-0 lg:mt-0">
          <span>
            © {new Date().getFullYear()} {brand.footerText}. {t("common.allRightsReserved")}
          </span>
          {APP_VERSION ? (
            <span className="mono">{t("common.version", { version: APP_VERSION })}</span>
          ) : null}
        </p>
      </aside>


      <main
        id="content"
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
