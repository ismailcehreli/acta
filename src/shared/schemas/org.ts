import { z } from "zod";

// Organizasyon ağacı girdileri (§4). Aynı şema hem formda hem sunucuda çalışır.

export const orgUnitNameSchema = z
  .string()
  .trim()
  .min(2, "Birim adı en az 2 karakter olmalı")
  .max(150, "Birim adı en fazla 150 karakter olabilir");

/** Kademe etiketi serbest metindir: kademeler koda gömülmez (İlke 1). */
export const orgUnitTypeSchema = z
  .string()
  .trim()
  .min(2, "Kademe adı en az 2 karakter olmalı")
  .max(50, "Kademe adı en fazla 50 karakter olabilir");

export const createOrgUnitSchema = z.object({
  name: orgUnitNameSchema,
  type: orgUnitTypeSchema,
  /** Boş bırakılırsa kök birim oluşturulur; ağaçta yalnızca bir kök olabilir. */
  parentId: z.string().uuid().nullable().default(null),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  // Davranış bayrakları (§4.3). Sürüm 1'de yalnızca veride durur.
  requiresApproval: z.boolean().default(false),
  autoFlowsUp: z.boolean().default(true),
  attentionGroupId: z.string().trim().max(100).nullable().default(null),
});

/**
 * Birim düzenleme (§4.3). Sistem yöneticisi birimin **kimliğini ve
 * davranışını** düzeltebilir; yeri (`parentId`) ve aktifliği ayrı işlemlerdir
 * — taşıma ağacın bütünlük kurallarını, pasifleştirme ise §16.6'yı ilgilendirir
 * ve ikisi de kendi kontrollerine sahiptir.
 */
export const updateOrgUnitSchema = z.object({
  id: z.string().uuid(),
  name: orgUnitNameSchema,
  type: orgUnitTypeSchema,
  requiresApproval: z.boolean(),
  autoFlowsUp: z.boolean(),
  attentionGroupId: z.string().trim().max(100).nullable().default(null),
});

export const moveOrgUnitSchema = z.object({
  id: z.string().uuid(),
  newParentId: z.string().uuid(),
  /**
   * Kullanıcının onayladığı mesai penceresi önizlemesinin imzası.
   *
   * Taşıma birimin devraldığı pencereyi değiştiriyorsa (tasarım Paket H)
   * sunucu bu imzayı **yeniden hesaplayıp** karşılaştırıyor: araya giren bir
   * takvim değişikliği, kullanıcının okuyup onayladığı cümleyi yanlış kılardı.
   */
  confirmedCalendarSignature: z.string().max(200).optional(),
});

export const deactivateOrgUnitSchema = z.object({
  id: z.string().uuid(),
});

export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;
export type MoveOrgUnitInput = z.infer<typeof moveOrgUnitSchema>;
