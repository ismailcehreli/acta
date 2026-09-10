import { z } from "zod";

// Soru–cevap girdileri (§9). Tur sınırı yoktur; mesaj uzunluğu faaliyet
// açıklamasıyla aynı üst sınırı taşır.

export const conversationMessageSchema = z
  .string()
  .trim()
  // Tasarım yalnız üst sınır tanımlar; üç karakterlik alt sınır ürün kararı
  // olmadan konmuştu ve "Evet" gibi geçerli cevapları reddediyordu
  // (denetim 18.08.2026, bulgu 13). Kalan tek kural: boş olamaz.
  .min(1, "Mesaj boş olamaz")
  .max(10_000, "Mesaj en fazla 10.000 karakter olabilir");

export const askQuestionSchema = z.object({
  activityId: z.string().uuid(),
  text: conversationMessageSchema,
});

export const replySchema = z.object({
  conversationId: z.string().uuid(),
  text: conversationMessageSchema,
});

/** Zorunlu kapatmanın nedeni (§9.3). Yalnız sistem yöneticisi kapatırken. */
export const administrativeCloseReasonSchema = z
  .string()
  .trim()
  .min(1, "Kapatma nedeni zorunludur")
  .max(500, "Gerekçe en fazla 500 karakter olabilir");

export const closeConversationSchema = z.object({
  conversationId: z.string().uuid(),
  reason: administrativeCloseReasonSchema.optional(),
});

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type CloseConversationInput = z.infer<typeof closeConversationSchema>;
