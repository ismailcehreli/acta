"use server";

import { redirect } from "next/navigation";

import { clearSessionCookie } from "@/server/auth/cookies";
import { getCurrentUser } from "@/server/auth/current-user";
import { changePassword } from "@/server/auth/change-password";
import { prisma } from "@/server/db";
import { changePasswordSchema } from "@/shared/schemas/auth";

import type { PasswordFormState } from "./form-state";

export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordRepeat: formData.get("newPasswordRepeat"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz" };
  }

  const result = await changePassword(
    { db: prisma, now: new Date() },
    {
      userId: user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    },
  );

  if (!result.ok) {
    if (result.reason === "conflict") {
      return {
        error:
          "Parolanız bu sırada başka bir oturumdan değiştirildi. Yeni parolanızla giriş yapıp tekrar deneyin.",
      };
    }

    return { error: "Mevcut parolanız hatalı." };
  }

  // Parola değişiminde tüm oturumlar iptal edilir (§15.3) — bu oturum da dahil.
  // Kullanıcı yeni parolasıyla yeniden giriş yapar.
  await clearSessionCookie();
  redirect("/login?parola=degisti");
}
