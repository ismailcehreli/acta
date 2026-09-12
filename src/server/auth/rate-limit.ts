import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./config";





//





//




const MAX_TRACKED_KEYS = 10_000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, FailureWindow>();

export interface FailureState {

  blocked: boolean;

  count: number;
  retryAfterMs: number;
}


export function pruneRateLimits(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}


function enforceCapacity(): void {
  if (windows.size <= MAX_TRACKED_KEYS) return;

  let overflow = windows.size - MAX_TRACKED_KEYS;
  for (const key of windows.keys()) {
    windows.delete(key);
    overflow -= 1;
    if (overflow <= 0) break;
  }
}


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


export function clearFailures(key: string): void {
  windows.delete(key);
}


export function resetRateLimits(): void {
  windows.clear();
}


export function trackedKeyCount(): number {
  return windows.size;
}
