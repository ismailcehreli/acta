import { z } from "zod";

// Read-ticket submission input (§10.2). The server validates every submission.

export const readTicketSubmissionSchema = z.object({
  activityId: z.string().uuid(),
  // Format: `<timestamp>.<signature>`; `reads/ticket.ts` verifies the contents.
  ticket: z.string().min(3).max(200),
});

export type ReadTicketSubmission = z.infer<typeof readTicketSubmissionSchema>;
