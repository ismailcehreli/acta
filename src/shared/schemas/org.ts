import { z } from "zod";

// Organization-tree input (§4), shared by the form and server.

export const orgUnitNameSchema = z
  .string()
  .trim()
  .min(2, "Unit name must be at least 2 characters")
  .max(150, "Unit name must be 150 characters or fewer");

/** Organization-unit type is free text; levels are not hard-coded (Principle 1). */
export const orgUnitTypeSchema = z
  .string()
  .trim()
  .min(2, "Unit type must be at least 2 characters")
  .max(50, "Unit type must be 50 characters or fewer");

export const createOrgUnitSchema = z.object({
  name: orgUnitNameSchema,
  type: orgUnitTypeSchema,
  /** Omit to create the root unit; the tree may have only one root. */
  parentId: z.string().uuid().nullable().default(null),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  // Behavior flags (§4.3) are stored as data in version 1.
  requiresApproval: z.boolean().default(false),
  autoFlowsUp: z.boolean().default(true),
  attentionGroupId: z.string().trim().max(100).nullable().default(null),
});

/**
 * Unit editing (§4.3). A system administrator can edit a unit's identity and
 * behavior; its location and active state use separate operations.
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
   * Signature of the work-window preview confirmed by the user. The server
   * recomputes it before moving a unit so a concurrent calendar change cannot
   * invalidate the text the user confirmed.
   */
  confirmedCalendarSignature: z.string().max(200).optional(),
});

export const deactivateOrgUnitSchema = z.object({
  id: z.string().uuid(),
});

export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;
export type MoveOrgUnitInput = z.infer<typeof moveOrgUnitSchema>;
