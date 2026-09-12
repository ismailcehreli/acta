import { z } from "zod";

// Question-and-answer input (§9). There is no turn limit; message length uses
// the same ceiling as an activity description.

export const conversationMessageSchema = z
  .string()
  .trim()
  // Only the upper bound is designed; a message may be a single word.
  .min(1, "Message cannot be empty")
  .max(10_000, "Message must be 10,000 characters or fewer");

export const askQuestionSchema = z.object({
  activityId: z.string().uuid(),
  text: conversationMessageSchema,
});

export const replySchema = z.object({
  conversationId: z.string().uuid(),
  text: conversationMessageSchema,
});

/** Reason required when a system administrator closes a conversation (§9.3). */
export const administrativeCloseReasonSchema = z
  .string()
  .trim()
  .min(1, "Closing reason is required")
  .max(500, "Reason must be 500 characters or fewer");

export const closeConversationSchema = z.object({
  conversationId: z.string().uuid(),
  reason: administrativeCloseReasonSchema.optional(),
});

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type CloseConversationInput = z.infer<typeof closeConversationSchema>;
