"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  createTranslator,
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_LANGUAGE_TAGS,
  type Locale,
} from "@/shared/i18n";

function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;

  const cookieValue = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.split("=")[1];

  return isSupportedLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

function subscribeToLocaleCookie(): () => void {
  return () => undefined;
}

function readServerLocale(): Locale {
  return DEFAULT_LOCALE;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    subscribeToLocaleCookie,
    readLocaleCookie,
    readServerLocale,
  );
  const t = useMemo(() => createTranslator(locale), [locale]);

  return (
    <html lang={LOCALE_LANGUAGE_TAGS[locale]}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "oklch(0.955 0.008 75)",
          color: "oklch(0.215 0.014 60)",
        }}
      >
        <main style={{ maxWidth: "34rem", borderInlineStart: "3px solid oklch(0.505 0.135 45)", paddingInlineStart: "1.25rem" }}>
          <p
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "oklch(0.505 0.135 45)",
              margin: "0 0 0.5rem",
            }}
          >
            {t("screens.errors.marker")}
          </p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            {t("screens.errors.unexpectedTitle")}
          </h1>
          <p style={{ fontSize: "0.875rem", color: "oklch(0.455 0.016 60)", margin: "0 0 1.5rem", lineHeight: 1.6 }}>
            {t("screens.errors.globalDescription")}
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: "4px",
              background: "oklch(0.505 0.135 45)",
              color: "#fff",
              padding: "0.65rem 1.1rem",
              minHeight: "44px",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("screens.errors.retry")}
          </button>

          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "oklch(0.565 0.014 62)", marginTop: "1.5rem", fontFamily: "ui-monospace, monospace" }}>
              {t("screens.errors.errorCode", { code: error.digest })}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
