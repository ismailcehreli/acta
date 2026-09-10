import { z } from "zod";

import { isoDaySchema } from "./iso-date";

// "Faaliyet beklenmiyor" günleri için giriş ve onay doğrulamaları.

export const absenceDateSchema = isoDaySchema();

export const markAbsenceSchema = z.object({
  userId: z.string().uuid(),
  startDate: absenceDateSchema,
  endDate: absenceDateSchema,
  note: z.string().trim().max(500, "Not en fazla 500 karakter olabilir").optional(),
  deputyId: z.string().uuid().optional(),
});

// Kayıt silinmez, gerekçeyle iptal edilir (§4.5, bulgu 7): vekilin
// geçmiş görünürlüğü bu satırdan türüyor.
export const cancelAbsenceSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "İptal gerekçesi yazılmalı")
    .max(500, "Gerekçe en fazla 500 karakter olabilir"),
});

export const absenceDecisionSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z
      .string()
      .trim()
      .max(500, "Gerekçe en fazla 500 karakter olabilir")
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "REJECTED" && !value.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reddetmek için gerekçe yazılmalı",
      });
    }
  });

export type MarkAbsenceInput = z.infer<typeof markAbsenceSchema>;
export type AbsenceDecisionInput = z.infer<typeof absenceDecisionSchema>;
