import {
  DELAY_BASE_MS,
  DELAY_MAX_MS,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from "./config";






export function loginDelayMs(failedAttempts: number): number {
  if (failedAttempts <= 0) return 0;

  const delay = DELAY_BASE_MS * 2 ** (failedAttempts - 1);
  return Math.min(delay, DELAY_MAX_MS);
}

export function isLockThresholdReached(failedAttempts: number): boolean {
  return failedAttempts >= MAX_FAILED_ATTEMPTS;
}


export function lockUntil(now: Date, minutes = LOCKOUT_MINUTES): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

export function isLocked(
  lockedUntil: Date | null,
  now: Date,
): lockedUntil is Date {
  return lockedUntil !== null && lockedUntil > now;
}
