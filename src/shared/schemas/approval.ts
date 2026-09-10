import { z } from "zod";

// Onay akışı girdileri (§5.4). Aynı şema hem formda hem sunucuda çalışır.

export const approveActivitySchema = z.object({
  id: z.string().uuid(),
});

/**
 * Onay kararının gerekçesi (ürün sahibi kararı, 19.08.2026).
 *
 * **Kategori zorunlu, açıklama isteğe bağlı.** Serbest metin raporlanamaz:
 * herkes kendi cümlesini yazarsa "faaliyetler neden reddediliyor" sorusu
 * sayıya dökülemez. Kategorileri sistem yöneticisi tanımlar.
 */
const decisionFields = {
  id: z.string().uuid(),
  reasonId: z.string().uuid("Gerekçe seçilmeli"),
  note: z
    .string()
    .trim()
    .max(1000, "Açıklama en fazla 1000 karakter olabilir")
    .optional()
    .or(z.literal("")),
};

export const requestChangesSchema = z.object(decisionFields);
export const rejectActivitySchema = z.object(decisionFields);

/** Gerekçe kataloğu yönetimi (§15.1: yalnız sistem yöneticisi). */
export const approvalReasonKindSchema = z.enum(["CHANGES_REQUESTED", "REJECTED"]);

export const createApprovalReasonSchema = z.object({
  kind: approvalReasonKindSchema,
  label: z
    .string()
    .trim()
    .min(2, "Gerekçe adı en az 2 karakter olmalı")
    .max(120, "Gerekçe adı en fazla 120 karakter olabilir"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const updateApprovalReasonSchema = z.object({
  id: z.string().uuid(),
  label: z
    .string()
    .trim()
    .min(2, "Gerekçe adı en az 2 karakter olmalı")
    .max(120, "Gerekçe adı en fazla 120 karakter olabilir"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const setApprovalReasonActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export type ApproveActivityInput = z.infer<typeof approveActivitySchema>;
export type RequestChangesInput = z.infer<typeof requestChangesSchema>;
export type RejectActivityInput = z.infer<typeof rejectActivitySchema>;
export type CreateApprovalReasonInput = z.infer<typeof createApprovalReasonSchema>;
export type UpdateApprovalReasonInput = z.infer<typeof updateApprovalReasonSchema>;
