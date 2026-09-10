import { z } from "zod";

const plainText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} boş bırakılamaz`)
    .max(max, `${label} en fazla ${max} karakter olabilir`)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), {
      message: `${label} HTML etiketi içeremez`,
    });

export const feedbackCategorySchema = z.enum([
  "BUG",
  "SUGGESTION",
  "CRITIQUE",
  "QUESTION",
]);

export const feedbackStatusSchema = z.enum(["NEW", "IN_REVIEW", "RESOLVED"]);

export const feedbackCreateSchema = z.object({
  category: feedbackCategorySchema,
  title: plainText("Başlık", 200),
  description: plainText("Açıklama", 10000),
  sourcePath: z
    .string()
    .trim()
    .max(500, "Sayfa yolu çok uzun")
    .optional()
    .transform((value) => value || null),
  // Yeni akışta tüm kayıtları yalnızca sistem yöneticileri yönetir. Alan eski
  // istemcilerle uyumluluk için kabul edilir ancak kullanıcıya gösterilmez.
  adminsOnly: z.boolean().default(false),
});

export const feedbackUpdateSchema = z.object({
  id: z.string().uuid(),
  status: feedbackStatusSchema,
  response: z
    .string()
    .trim()
    .max(5000, "Yanıt en fazla 5000 karakter olabilir")
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), {
      message: "Yanıt HTML etiketi içeremez",
    })
    .optional()
    .transform((value) => value || null),
});

export const feedbackReadSchema = z.object({
  id: z.string().uuid(),
});

export const feedbackArchiveSchema = z.object({
  id: z.string().uuid(),
});

export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;
export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>;
