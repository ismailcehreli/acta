import { z } from "zod";

// Push aboneliği girdileri (Görev 5.3b). Tarayıcının ürettiği `PushSubscription`
// nesnesinin JSON hâli; sunucuda da aynı şemayla doğrulanır.

const endpointSchema = z
  .string()
  .trim()
  .url("Abonelik adresi geçersiz")
  .max(1000, "Abonelik adresi çok uzun");

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // Tarayıcı anahtarları base64url'dir; başka bir şey gelmesi bozuk istemci
  // ya da elle uydurulmuş istek demektir.
  .regex(/^[A-Za-z0-9_-]+=*$/, "Anahtar biçimi geçersiz");

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
