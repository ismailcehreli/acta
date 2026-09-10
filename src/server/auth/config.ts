// Kimlik ve oturum ayarları (§15.3). Tasarım bu değerlerin sayısal
// karşılığını vermediği için makul varsayılanlar seçildi; hepsi tek yerde
// durur ki değiştirmek için kod aramak gerekmesin.

/** Kaç ardışık hatalı denemeden sonra hesap geçici olarak kilitlenir. */
export const MAX_FAILED_ATTEMPTS = 10;

/** Kilit süresi (dakika). Süre dolunca sayaç sıfırlanır. */
export const LOCKOUT_MINUTES = 15;

/** Artan gecikmenin tabanı ve tavanı (ms). Sözlük saldırısını yavaşlatır. */
export const DELAY_BASE_MS = 200;
export const DELAY_MAX_MS = 5_000;

/** Oturum ömrü (saat). Süre dolduğunda yeniden giriş gerekir. */
export const SESSION_HOURS = 12;

/** Giriş ucundaki hız sınırı: pencere içinde en fazla kaç deneme. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 20;

/**
 * Argon2id parametreleri. Kütüphanenin OWASP'a uygun varsayılanları kullanılır;
 * yalnızca bellek maliyeti açıkça yazılır ki sunucu değiştiğinde gözden kaçmasın.
 */
export const ARGON2_MEMORY_COST_KIB = 19_456; // 19 MiB
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;

/**
 * Uygulama imzalama anahtarı. Okuma bileti (§10.2) bununla imzalanır; parola
 * sıfırlama belirteci de (Görev 5.5) buradan beslenecek. Varsayılanı yoktur —
 * eksikse uygulama açılışta durur, sessizce zayıf bir anahtara düşmez.
 */
export function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_SECRET tanımlı değil ya da 32 karakterden kısa. `.env` dosyasını " +
        "doldurun (bkz. .env.example).",
    );
  }
  return secret;
}
