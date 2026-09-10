import { z } from "zod";

import { isCalendarDay } from "./iso-date";

// Takip maddesi girdileri (§11). Aynı şema hem formda hem sunucuda çalışır.

const noteSchema = z
  .string()
  .trim()
  .max(1000, "Not en fazla 1000 karakter olabilir");

export const openFollowUpSchema = z.object({
  activityId: z.string().uuid(),
  nextStep: z
    .string()
    .trim()
    .max(500, "Sonraki adım en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  /** `YYYY-MM-DD`; boş bırakılabilir. */
  reviewDate: z
    .string()
    .trim()
    .refine(isCalendarDay, "Tarih geçersiz")
    .optional()
    .or(z.literal("")),
});

/**
 * Kapanış notu **zorunludur** (§11.1). Notsuz kapatma, Excel'deki ölü
 * Açık/Kapalı sütununun ta kendisiydi: kapatmanın bedeli yoksa herkes kapatır
 * ve kimse ne olduğunu bilmez. Veritabanı da boş bırakılmasına izin vermiyor.
 */
export const closeFollowUpSchema = z.object({
  id: z.string().uuid(),
  note: noteSchema.min(1, "Kapanış notu zorunludur"),
});

export const reopenFollowUpSchema = z.object({
  id: z.string().uuid(),
  note: noteSchema.min(1, "Yeniden açma gerekçesi zorunludur"),
});

export const transferFollowUpSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid("Devredilecek kişi seçilmeli"),
});
