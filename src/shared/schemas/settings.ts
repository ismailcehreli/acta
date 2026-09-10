import { z } from "zod";

// SMTP ayarları (§12.3, §16.5). Parola alanı **boş bırakılabilir**: boşsa
// mevcut parola korunur, çünkü ekranda hiç gösterilmiyor.

export const smtpSettingsSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, "Sunucu adresi zorunludur")
    .max(255, "Sunucu adresi en fazla 255 karakter olabilir"),
  port: z.coerce
    .number()
    .int("Port tam sayı olmalı")
    .min(1, "Port 1 ile 65535 arasında olmalı")
    .max(65535, "Port 1 ile 65535 arasında olmalı"),
  secure: z.boolean().default(false),
  user: z.string().trim().max(255).optional().default(""),
  password: z.string().max(255).optional(),
  from: z
    .string()
    .trim()
    .min(1, "Gönderen adresi zorunludur")
    .max(255, "Gönderen adresi en fazla 255 karakter olabilir"),
});

export const testEmailSchema = z.object({
  to: z.string().trim().email("Geçerli bir e-posta adresi girin"),
});

export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
