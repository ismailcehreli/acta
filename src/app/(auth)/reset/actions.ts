"use server";

import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { prisma } from "@/server/db";
import { resetPasswordSchema, resetRequestSchema } from "@/shared/schemas/auth";

import type { ResetFormState } from "./form-state";

// Sıfırlama akışı (§15.3). İstek yolu kullanıcı numaralandırmasına izin vermez:
// kayıtlı, kayıtsız ve pasif e-posta **aynı** cevabı alır.

const ISTEK_CEVABI =
  "Bu adres kayıtlıysa parola sıfırlama bağlantısı gönderildi. " +
  "Bağlantı bir saat geçerlidir.";

export async function requestResetAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });

  // Geçersiz e-posta biçimi bile aynı cevabı alır: "geçersiz" demek, geçerli
  // biçimdeki adreslerin kayıtlı olup olmadığını ayırt etmeye yarardı.
  if (!parsed.success) return { error: null, info: ISTEK_CEVABI };

  await requestPasswordReset(prisma, parsed.data.email, new Date());

  return { error: null, info: ISTEK_CEVABI };
}

export async function resetPasswordAction(
  _previous: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    newPasswordRepeat: formData.get("newPasswordRepeat"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Girdi geçersiz",
      info: null,
    };
  }

  const sonuc = await resetPassword(
    prisma,
    parsed.data.token,
    parsed.data.newPassword,
    new Date(),
  );

  if (!sonuc.ok) {
    // Üç durum ayrı ayrı anlatılır: kullanıcı ne yapacağını bilmeli. Hiçbiri
    // hesabın var olup olmadığını ele vermiyor.
    const mesaj =
      sonuc.reason === "expired_token"
        ? "Bağlantının süresi dolmuş. Yeni bir sıfırlama isteği gönderin."
        : sonuc.reason === "used_token"
          ? "Bu bağlantı kullanılmış. Yeni bir sıfırlama isteği gönderin."
          : "Bağlantı geçersiz. Adresi eksiksiz kopyaladığınızdan emin olun.";

    return { error: mesaj, info: null };
  }

  return {
    error: null,
    info: "Parolanız değiştirildi ve açık oturumlarınız kapatıldı. Şimdi giriş yapabilirsiniz.",
  };
}
