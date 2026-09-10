import { companyDay } from "@/server/activities/date-rules";
import { companyHour } from "@/shared/format/date-time";

// Gönderim kararı (§12.3). Saf fonksiyonlarda tutulur: sahte saatle ve
// veritabanı olmadan sınanabilsin diye.

/**
 * Artan aralıklı yeniden deneme. Beşinci denemeden sonra bildirim "başarısız"
 * işaretlenir ve operasyon ekranında görünür — sessizce kaybolmaz.
 */
export const RETRY_DELAYS_MS = [
  60_000, // 1 dk
  5 * 60_000, // 5 dk
  15 * 60_000, // 15 dk
  60 * 60_000, // 1 saat
  3 * 60 * 60_000, // 3 saat
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** Günlük özetin gönderileceği saat (şirket saati). */
export const DIGEST_HOUR = 18;

export interface QueuedNotification {
  id: string;
  userId: string;
  eventType: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

/**
 * Sıradaki deneme zamanı geldi mi? Hiç denenmemiş bildirim beklemez; denenmiş
 * olan, deneme sayısına göre artan bir süre bekler.
 */
export function isRetryDue(
  notification: Pick<QueuedNotification, "attemptCount" | "lastAttemptAt">,
  now: Date,
): boolean {
  if (notification.attemptCount === 0) return true;
  if (notification.attemptCount >= MAX_ATTEMPTS) return false;
  if (!notification.lastAttemptAt) return true;

  const delay = RETRY_DELAYS_MS[notification.attemptCount - 1];
  return now.getTime() - notification.lastAttemptAt.getTime() >= delay;
}

/** Denemeler tükendi mi? Tükendiyse bildirim `FAILED` olur. */
export function isExhausted(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}

/**
 * Günlük özet modundaki kullanıcıya bugün gönderim yapılır mı?
 *
 * Koşul iki parçalı: özet saati gelmiş olmalı **ve** bugün henüz özet
 * gitmemiş olmalı. İkincisi olmadan, saat 18'den sonraki her turda yeni bir
 * özet giderdi.
 */
export function isDigestDue(
  now: Date,
  lastDigestAt: Date | null,
  digestHour = DIGEST_HOUR,
): boolean {
  if (companyHour(now) < digestHour) return false;
  if (!lastDigestAt) return true;

  return companyDay(lastDigestAt) !== companyDay(now);
}
