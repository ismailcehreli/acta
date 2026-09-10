import { z } from "zod";

import { isoDaySchema } from "./iso-date";

// Faaliyet girdisi (§5.2). Tasarımda olmayan alan eklenmez: "üst yönetim
// görsün" kutusu v3'te kaldırıldı (§7.5), "açık kalsın" işareti Sürüm 2'ye ait
// (§11) — ikisi de burada yoktur.

/** En fazla 5 muhatap departman seçilebilir (§5.2, §16.2). */
export const MAX_TARGET_DEPARTMENTS = 5;

export const activityDateSchema = isoDaySchema();

/**
 * Metin uzunluk sınırları (Görev 11.6).
 *
 * Sınırlar artık **ayardan** geliyor ve şema bir fabrikadır: aynı sayılar hem
 * istemcide hem sunucuda kullanılıyor, ekran ile doğrulama ayrışamıyor.
 *
 * Varsayılan alt sınır **1**, yani "boş olmasın" demek. Koda sessizce girmiş
 * üç karakterlik bir alt sınır "İK" başlıklı geçerli bir kaydı reddediyordu
 * (denetim 21.08.2026, bulgu 16); §3 İlke 4 gereği zorunluluğu
 * kanıtlanmamış kısıt eklenmez. Sınırı yükseltmek artık şirketin kararı.
 */
export interface ActivityTextLimits {
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
}

/** Ayar okunamayan yerlerde (taslak gibi) kullanılan gevşek tavan. */
export const DEFAULT_TEXT_LIMITS: ActivityTextLimits = {
  titleMin: 1,
  titleMax: 150,
  descriptionMin: 1,
  descriptionMax: 10_000,
};

export function activityTitleSchema(limits: ActivityTextLimits) {
  return z
    .string()
    .trim()
    .min(
      limits.titleMin,
      limits.titleMin <= 1
        ? "Başlık yazılmalı"
        : `Başlık en az ${limits.titleMin} karakter olmalı`,
    )
    .max(limits.titleMax, `Başlık en fazla ${limits.titleMax} karakter olabilir`);
}

export function activityDescriptionSchema(limits: ActivityTextLimits) {
  return z
    .string()
    .trim()
    .min(
      limits.descriptionMin,
      limits.descriptionMin <= 1
        ? "Açıklama yazılmalı"
        : `Açıklama en az ${limits.descriptionMin} karakter olmalı`,
    )
    .max(
      limits.descriptionMax,
      `Açıklama en fazla ${limits.descriptionMax.toLocaleString("tr-TR")} karakter olabilir`,
    );
}

export const targetDepartmentsSchema = z
  .array(z.string().uuid())
  .min(1, "En az bir ilgili departman seçilmeli")
  .max(
    MAX_TARGET_DEPARTMENTS,
    `En fazla ${MAX_TARGET_DEPARTMENTS} departman seçilebilir`,
  )
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Aynı departman iki kez seçilemez",
  });

export function createActivitySchema(limits: ActivityTextLimits) {
  return z.object({
    activityDate: activityDateSchema,
    title: activityTitleSchema(limits),
    description: activityDescriptionSchema(limits),
    targetDepartmentIds: targetDepartmentsSchema,
  });
}

export function updateActivitySchema(limits: ActivityTextLimits) {
  return createActivitySchema(limits).extend({ id: z.string().uuid() });
}

export type CreateActivityInput = z.infer<ReturnType<typeof createActivitySchema>>;
export type UpdateActivityInput = z.infer<ReturnType<typeof updateActivitySchema>>;
