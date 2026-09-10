"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { LOCALE_COOKIE_NAME, isSupportedLocale } from "@/shared/i18n";

export async function setLocaleAction(newLocale: string): Promise<{ ok: boolean }> {
  if (!isSupportedLocale(newLocale)) {
    return { ok: false };
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, newLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
