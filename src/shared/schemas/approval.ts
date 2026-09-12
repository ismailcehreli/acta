import { z } from "zod";

// Approval-flow input (§5.4), shared by the form and server.

export const approveActivitySchema = z.object({
  id: z.string().uuid(),
});

/**
 * Reason for an approval decision.
 *
 * The category is required and the description is optional. Free-form text
 * cannot be reported consistently, so system administrators define categories.
 */
const decisionFields = {
  id: z.string().uuid(),
  reasonId: z.string().uuid("Select a reason"),
  note: z
    .string()
    .trim()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional()
    .or(z.literal("")),
};

export const requestChangesSchema = z.object(decisionFields);
export const rejectActivitySchema = z.object(decisionFields);

/** Approval-reason catalog management (§15.1). */
export const approvalReasonKindSchema = z.enum(["CHANGES_REQUESTED", "REJECTED"]);

export const createApprovalReasonSchema = z.object({
  kind: approvalReasonKindSchema,
  label: z
    .string()
    .trim()
    .min(2, "The reason name must be at least 2 characters")
    .max(120, "The reason name cannot exceed 120 characters"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const updateApprovalReasonSchema = z.object({
  id: z.string().uuid(),
  label: z
    .string()
    .trim()
    .min(2, "The reason name must be at least 2 characters")
    .max(120, "The reason name cannot exceed 120 characters"),
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
