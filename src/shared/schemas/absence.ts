import { z } from "zod";

import { isoDaySchema } from "./iso-date";

// Validation for leave periods and their decisions.

export const absenceDateSchema = isoDaySchema();

export const markAbsenceSchema = z.object({
  userId: z.string().uuid(),
  startDate: absenceDateSchema,
  endDate: absenceDateSchema,
  note: z.string().trim().max(500, "Note must be 500 characters or fewer").optional(),
  deputyId: z.string().uuid().optional(),
});

// Records are cancelled with a reason instead of being deleted.
export const cancelAbsenceSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Cancellation reason is required")
    .max(500, "Reason must be 500 characters or fewer"),
});

export const absenceDecisionSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z
      .string()
      .trim()
      .max(500, "Reason must be 500 characters or fewer")
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "REJECTED" && !value.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "A reason is required to reject a leave request",
      });
    }
  });

export type MarkAbsenceInput = z.infer<typeof markAbsenceSchema>;
export type AbsenceDecisionInput = z.infer<typeof absenceDecisionSchema>;
