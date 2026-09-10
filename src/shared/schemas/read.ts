import { z } from "zod";

// Okuma kaydı girdisi (§10.2). Sunucu eylemi doğrulanmamış veri kabul
// etmiyordu (denetim 18.08.2026, FAZ 4 bulgu 8).

export const readTicketSubmissionSchema = z.object({
  activityId: z.string().uuid(),
  // Biçim: "<zaman>.<imza>"; içeriği `reads/ticket.ts` doğrular.
  ticket: z.string().min(3).max(200),
});

export type ReadTicketSubmission = z.infer<typeof readTicketSubmissionSchema>;
