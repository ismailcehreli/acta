import { companyDay } from "@/server/activities/date-rules";
import { companyHour } from "@/shared/format/date-time";





export const RETRY_DELAYS_MS = [
  60_000, // 1 dk
  5 * 60_000, // 5 dk
  15 * 60_000, // 15 dk
  60 * 60_000, // 1 saat
  3 * 60 * 60_000, // 3 saat
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;


export const DIGEST_HOUR = 18;

export interface QueuedNotification {
  id: string;
  userId: string;
  eventType: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}


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


export function isExhausted(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}


export function isDigestDue(
  now: Date,
  lastDigestAt: Date | null,
  digestHour = DIGEST_HOUR,
): boolean {
  if (companyHour(now) < digestHour) return false;
  if (!lastDigestAt) return true;

  return companyDay(lastDigestAt) !== companyDay(now);
}
