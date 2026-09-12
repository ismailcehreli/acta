import { z } from "zod";

// A cancellation reason is required so the record's history remains clear.
export const cancelActivitySchema = z.object({
  id: z.string().uuid(),
  // The design requires a reason but does not impose an undocumented minimum
  // length; short, meaningful reasons are valid.
  reason: z
    .string()
    .trim()
    .min(1, "Cancellation reason is required")
    .max(1000, "Reason must be 1000 characters or fewer"),
});

export type CancelActivityInput = z.infer<typeof cancelActivitySchema>;
