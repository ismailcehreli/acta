import {
  DELAY_BASE_MS,
  DELAY_MAX_MS,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from "./config";

// Ardışık başarısız girişte artan gecikme, 10 denemede geçici kilit (§15.3).
// Saf hesaplama burada tutulur: veritabanı ve saat okuması dışarıda kalır,
// böylece kural sahte saatle test edilebilir.

/**
 * Bir sonraki denemeden önce beklenecek süre. Gecikme deneme sayısıyla ikiye
 * katlanır ve tavanda durur; ilk hata anında fark edilmeyecek kadar kısadır,
 * otomatik saldırı için ise dayanılmayacak kadar uzar.
 */
export function loginDelayMs(failedAttempts: number): number {
  if (failedAttempts <= 0) return 0;

  const delay = DELAY_BASE_MS * 2 ** (failedAttempts - 1);
  return Math.min(delay, DELAY_MAX_MS);
}

export function isLockThresholdReached(failedAttempts: number): boolean {
  return failedAttempts >= MAX_FAILED_ATTEMPTS;
}

/** Kilidin biteceği an. Süre sistem ayarlarından gelir (§16.5). */
export function lockUntil(now: Date, minutes = LOCKOUT_MINUTES): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

export function isLocked(
  lockedUntil: Date | null,
  now: Date,
): lockedUntil is Date {
  return lockedUntil !== null && lockedUntil > now;
}
