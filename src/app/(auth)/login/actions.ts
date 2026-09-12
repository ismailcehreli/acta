"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { setSessionCookie } from "@/server/auth/cookies";
import { login } from "@/server/auth/login";
import { prisma } from "@/server/db";
import { loginSchema } from "@/shared/schemas/auth";
import { localizeValidationIssue } from "@/shared/i18n/message";
import { getTranslations } from "@/server/i18n/server";

export interface LoginFormState {
  error: string | null;
}


async function clientKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown-client";
}






export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const t = await getTranslations();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") === "on",
  });

  if (!parsed.success) {
    return { error: localizeValidationIssue(t, parsed.error.issues[0]) };
  }

  const result = await login(
    { db: prisma, now: new Date(), rateLimitKey: await clientKey() },
    parsed.data,
  );

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return {
        error: t("auth.tooManyAttempts"),
      };
    }

    return { error: t("auth.invalidCredentials") };
  }

  await setSessionCookie(result.session.token, result.session.expiresAt);

  redirect(result.mustChangePassword ? "/password?required=1" : "/");
}
