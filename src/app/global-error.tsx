"use client";

// Kök yerleşimin kendisi çöktüğünde çalışan son çare (Görev 10.1).
//
// `error.tsx` kök yerleşimin içinde çizilir; yerleşim çökerse o da çizilemez.
// Bu dosya **kendi `<html>` ve `<body>` etiketlerini** üretmek zorunda ve
// hiçbir şeye bağımlı olamaz — tasarım belirteçleri de yüklenmemiş olabilir,
// bu yüzden renkler burada elle yazıldı — ama **sistemin renkleri** olarak:
// sıcak mineral zemin ve pas rengi eylem, oklch değerleriyle doğrudan.
// Kullanıcının bomboş bir beyaz ekran görmemesi için var.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
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
            Hata
          </p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Uygulama açılamadı
          </h1>
          <p style={{ fontSize: "0.875rem", color: "oklch(0.455 0.016 60)", margin: "0 0 1.5rem", lineHeight: 1.6 }}>
            Beklenmeyen bir hata oluştu. Sorun sürerse sistem yöneticinize
            aşağıdaki hata kodunu iletin.
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
            Tekrar dene
          </button>

          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "oklch(0.565 0.014 62)", marginTop: "1.5rem", fontFamily: "ui-monospace, monospace" }}>
              Hata kodu: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
