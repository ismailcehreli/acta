import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./config";

// Giriş ucunda hız sınırı (§15.3). Sayaç uygulama sürecinin belleğinde durur:
// sistem tek uygulama kopyasıyla çalışır (§17.2) ve hesap kilidi zaten
// veritabanındadır — bellekteki sayaç ikinci bir savunma katmanıdır, tek
// savunma değil. Uygulama yeniden başlarsa sayaç sıfırlanır; kilit sıfırlanmaz.
//
// **Sayılan şey başarısız denemelerdir, istek sayısı değil.** İlk sürümde her
// istek sayılıyordu; bu iki gerçek sorunu getiriyordu: (1) şirket tek bir dış
// adresin arkasındadır (§15.5), sabah aynı anda giriş yapan 20 kişi birbirini
// kilitlerdi; (2) meşru kullanıcı sık giriş yaptığı için cezalandırılırdı.
// Sözlük saldırısını yavaşlatan şey zaten başarısız denemelerdir.
//
// Sayaç hem istemci adresi hem denenen hesap için tutulur: adres başlıktan
// geldiği için değiştirilebilir, hesap değiştirilemez (denetim, bulgu 7).

/** Bellekte tutulacak azami anahtar sayısı; aşılırsa en eskiler atılır. */
const MAX_TRACKED_KEYS = 10_000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, FailureWindow>();

export interface FailureState {
  /** Sınır aşıldı mı; aşıldıysa giriş denemesi hiç işlenmez. */
  blocked: boolean;
  /** Pencere içindeki başarısız deneme sayısı. */
  count: number;
  retryAfterMs: number;
}

/** Süresi dolmuş pencereleri atar; harita sonsuza kadar büyümesin diye. */
export function pruneRateLimits(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Kapasite dolduğunda en eski kayıtlar atılır. Yeni anahtarı reddetmek
 * (fail-closed) tek bir saldırganın bütün şirketin girişini kesmesine izin
 * verirdi; bu yüzden sayaç yaşlanır, giriş kapanmaz.
 */
function enforceCapacity(): void {
  if (windows.size <= MAX_TRACKED_KEYS) return;

  let overflow = windows.size - MAX_TRACKED_KEYS;
  for (const key of windows.keys()) {
    windows.delete(key);
    overflow -= 1;
    if (overflow <= 0) break;
  }
}

/** Sayacı **artırmadan** durumu okur. */
export function peekFailures(key: string, now: number): FailureState {
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    return { blocked: false, count: 0, retryAfterMs: 0 };
  }

  return {
    blocked: current.count >= RATE_LIMIT_MAX_REQUESTS,
    count: current.count,
    retryAfterMs: current.resetAt - now,
  };
}

/** Başarısız denemeyi kaydeder ve yeni durumu döndürür. */
export function recordFailure(key: string, now: number): FailureState {
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    pruneRateLimits(now);
    windows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    enforceCapacity();
    return { blocked: false, count: 1, retryAfterMs: RATE_LIMIT_WINDOW_MS };
  }

  current.count += 1;
  return {
    blocked: current.count >= RATE_LIMIT_MAX_REQUESTS,
    count: current.count,
    retryAfterMs: current.resetAt - now,
  };
}

/** Başarılı girişten sonra sayaç temizlenir. */
export function clearFailures(key: string): void {
  windows.delete(key);
}

/** Testlerin birbirini etkilememesi için sayaçları temizler. */
export function resetRateLimits(): void {
  windows.clear();
}

/** İzlenen anahtar sayısı; kapasite testlerinde kullanılır. */
export function trackedKeyCount(): number {
  return windows.size;
}
