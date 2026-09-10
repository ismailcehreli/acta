"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { setSessionCookie } from "@/server/auth/cookies";
import { login } from "@/server/auth/login";
import { prisma } from "@/server/db";
import { loginSchema } from "@/shared/schemas/auth";

export interface LoginFormState {
  error: string | null;
}

/** Hız sınırı anahtarı. Ters vekil sunucu arkasında gerçek istemci adresi
 *  X-Forwarded-For başlığının ilk değeridir (§15.5). */
async function clientKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "bilinmeyen-istemci";
}

// Kimlik bilgisi hatalı da olsa, hesap kilitli de olsa kullanıcıya aynı metin
// gösterilir. Ayrı bir "hesabınız kilitlendi" mesajı, o e-postanın kayıtlı
// olduğunu doğrular ve hesap numaralandırmaya yol açardı (denetim,
// bulgu 8). Kilitlenme ihtimali metinde genel olarak anılır ki gerçek kullanıcı
// neden giremediğini anlasın.
const GENERIC_LOGIN_ERROR =
  "E-posta veya parola hatalı. Çok fazla hatalı deneme yapıldıysa giriş bir " +
  "süreliğine kapatılmış olabilir; birkaç dakika sonra tekrar deneyin.";

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz" };
  }

  const result = await login(
    { db: prisma, now: new Date(), rateLimitKey: await clientKey() },
    parsed.data,
  );

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      // Hız sınırı istemci ve hesap sayacından gelir; hesabın var olup
      // olmadığını ele vermez, bu yüzden ayrı metin verilebilir.
      return {
        error: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
      };
    }

    return { error: GENERIC_LOGIN_ERROR };
  }

  await setSessionCookie(result.session.token, result.session.expiresAt);

  // redirect() bir istisna fırlatarak çalışır; bu yüzden try/catch dışındadır.
  redirect(result.mustChangePassword ? "/parola?zorunlu=1" : "/");
}
