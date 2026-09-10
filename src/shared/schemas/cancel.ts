import { z } from "zod";

// İptal gerekçesi zorunludur (§5.5): kaydın neden iptal edildiği sonradan
// okunabilmeli.
export const cancelActivitySchema = z.object({
  id: z.string().uuid(),
  // Tasarım §5.5 yalnızca gerekçenin zorunlu olmasını istiyor; asgari uzunluk
  // ürün sahibi kararı olmadan konmuştu ve geçerli kısa gerekçeleri
  // reddediyordu (denetim 18.08.2026, bulgu 10).
  reason: z
    .string()
    .trim()
    .min(1, "İptal gerekçesi zorunludur")
    .max(1000, "Gerekçe en fazla 1000 karakter olabilir"),
});

export type CancelActivityInput = z.infer<typeof cancelActivitySchema>;
