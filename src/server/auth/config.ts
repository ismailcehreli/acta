




export const MAX_FAILED_ATTEMPTS = 10;


export const LOCKOUT_MINUTES = 15;


export const DELAY_BASE_MS = 200;
export const DELAY_MAX_MS = 5_000;


export const SESSION_HOURS = 12;


export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 20;


export const ARGON2_MEMORY_COST_KIB = 19_456; // 19 MiB
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;


export function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_SECRET is missing or shorter than 32 characters. Set it in `.env` (see .env.example).",
    );
  }
  return secret;
}
