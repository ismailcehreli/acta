import { cookies } from "next/headers";

// Oturum belirteci yalnızca çerezde taşınır: httpOnly olduğu için sayfadaki
// hiçbir betik okuyamaz, sameSite=lax olduğu için başka sitelerden gönderilmez.

export const SESSION_COOKIE_NAME = "faaliyet_oturum";

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Üretimde sistem yalnızca HTTPS üzerinden yayınlanır (§15.5).
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
