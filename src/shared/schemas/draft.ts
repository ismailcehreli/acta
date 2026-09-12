import { z } from "zod";

import { isCalendarDay } from "./iso-date";

import { MAX_TARGET_DEPARTMENTS } from "./activity";

// Activity-draft input.
//
// Draft validation is intentionally loose. A draft is an unfinished form:
// its title or description may be empty and no department may be selected.
//
// The same length ceilings as activities still apply because drafts use the
// same columns. The activity schema is applied fully when a draft is sent.

export const saveDraftSchema = z.object({
  /** Existing draft ID when updating; omitted when creating a new draft. */
  id: z.string().uuid().optional(),
  activityDate: z
    .string()
    .refine(isCalendarDay, "Invalid date format"),
  title: z.string().max(150, "Title must be 150 characters or fewer"),
  description: z
    .string()
    .max(10_000, "Description must be 10,000 characters or fewer"),
  targetDepartmentIds: z
    .array(z.string().uuid())
    .max(MAX_TARGET_DEPARTMENTS),
  openFollowUp: z.boolean().default(false),
  /** Whether the user explicitly saved it; `false` for autosaves. */
  savedManually: z.boolean().default(false),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const draftIdSchema = z.object({ id: z.string().uuid() });
