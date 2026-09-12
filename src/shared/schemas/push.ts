import { z } from "zod";

// Push-subscription input. The browser-generated JSON is validated again on
// the server with the same schema.

const endpointSchema = z
  .string()
  .trim()
  .url("Subscription endpoint is invalid")
  .max(1000, "Subscription endpoint is too long");

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // Browser keys use base64url; anything else indicates a malformed client
  // or a hand-crafted request.
  .regex(/^[A-Za-z0-9_-]+=*$/, "Key format is invalid");

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: keySchema,
    auth: keySchema,
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: endpointSchema,
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
