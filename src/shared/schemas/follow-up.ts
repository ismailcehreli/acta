import { z } from "zod";

import { isCalendarDay } from "./iso-date";

// Follow-up item input (§11), shared by the form and server.

const noteSchema = z
  .string()
  .trim()
  .max(1000, "Note must be 1,000 characters or fewer");

export const openFollowUpSchema = z.object({
  activityId: z.string().uuid(),
  nextStep: z
    .string()
    .trim()
    .max(500, "Next step must be 500 characters or fewer")
    .optional()
    .or(z.literal("")),
  /** `YYYY-MM-DD`; may be blank. */
  reviewDate: z
    .string()
    .trim()
    .refine(isCalendarDay, "Invalid date")
    .optional()
    .or(z.literal("")),
});

/**
 * A closing note is required (§11.1) so a closed item remains understandable.
 * The database enforces the same rule.
 */
export const closeFollowUpSchema = z.object({
  id: z.string().uuid(),
  note: noteSchema.min(1, "Closing note is required"),
});

export const reopenFollowUpSchema = z.object({
  id: z.string().uuid(),
  note: noteSchema.min(1, "Reason for reopening is required"),
});

export const transferFollowUpSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid("Select an assignee"),
});
