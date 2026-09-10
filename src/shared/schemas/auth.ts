import { z } from "zod";

// İstemci ve sunucu aynı şemayı kullanır: tarayıcıda gösterilen hata ile
// sunucunun kabul ettiği veri hiçbir zaman ayrışmaz.

export const emailSchema = z
  .string()
  .trim()
  .min(1, "E-posta adresi gerekli")
  .max(255, "E-posta adresi çok uzun")
  .email("Geçerli bir e-posta adresi girin")
  .transform((value) => value.toLowerCase());

/** Parola kuralı: uzunluk tek ölçüt (§15.3 — MFA yok, karmaşıklık dayatılmaz). */
export const passwordSchema = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı")
  .max(200, "Parola en fazla 200 karakter olabilir");

export const loginSchema = z.object({
  email: emailSchema,
  // Girişte parola kuralı uygulanmaz: eski kısa parolalı kullanıcı da giriş
  // yapabilmeli, ayrıca kural mesajı parola uzunluğunu ele verirdi.
  password: z.string().min(1, "Parola gerekli").max(200),
  /**
   * "Beni hatırla". Yalnız oturumun **süresini** uzatır; başka hiçbir
   * güvenlik kuralını gevşetmez — kilitlenme, hız sınırı ve parola
   * değişiminde oturumların iptali aynen işler.
   */
  remember: z.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut parola gerekli").max(200),
    newPassword: passwordSchema,
    newPasswordRepeat: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordRepeat, {
    path: ["newPasswordRepeat"],
    message: "Parolalar eşleşmiyor",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Parola sıfırlama isteği (§15.3). */
export const resetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
    newPasswordRepeat: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordRepeat, {
    message: "Parolalar aynı olmalı",
    path: ["newPasswordRepeat"],
  });
