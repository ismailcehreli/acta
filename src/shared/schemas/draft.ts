import { z } from "zod";

import { isCalendarDay } from "./iso-date";

import { MAX_TARGET_DEPARTMENTS } from "./activity";

// Faaliyet taslağı girdileri (21.08.2026).
//
// **Taslak doğrulaması gevşektir ve öyle olmalı.** Faaliyet kaydı zorunlu
// alan ister; taslak yarım kalmış bir formdur — başlığı boş, açıklaması tek
// kelime, departmanı seçilmemiş olabilir. Sıkı doğrulama, otomatik kaydetmeyi
// tam da işe yarayacağı anda (metin henüz yarımken) reddederdi.
//
// Gevşeklik **sınırsızlık değil**: uzunluk sınırları faaliyetle aynı, çünkü
// aynı sütunlara yazılacak. Taslak gönderilirken faaliyetin kendi şeması
// yeniden ve tam olarak uygulanır.

export const saveDraftSchema = z.object({
  /** Var olan taslak güncelleniyorsa kimliği; yoksa yenisi açılır. */
  id: z.string().uuid().optional(),
  activityDate: z
    .string()
    .refine(isCalendarDay, "Tarih biçimi geçersiz"),
  title: z.string().max(150, "Başlık en fazla 150 karakter olabilir"),
  description: z
    .string()
    .max(10_000, "Açıklama en fazla 10.000 karakter olabilir"),
  targetDepartmentIds: z
    .array(z.string().uuid())
    .max(MAX_TARGET_DEPARTMENTS),
  openFollowUp: z.boolean().default(false),
  /** Kullanıcı bilerek mi kaydetti? Otomatik kaydetmede `false`. */
  savedManually: z.boolean().default(false),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const draftIdSchema = z.object({ id: z.string().uuid() });
