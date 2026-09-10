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

export const helpArticleSchema = z.object({
  category: plainText("Kategori", 60),
  title: plainText("Başlık", 200),
  answer: plainText("Açıklama", 10000),
  sortOrder: z.coerce.number().int().min(0).max(10000),
  isPublished: z.boolean(),
});

export const helpArticleUpdateSchema = helpArticleSchema.extend({
  id: z.string().uuid(),
});

export const helpArticleArchiveSchema = z.object({
  id: z.string().uuid(),
});

export type HelpArticleInput = z.infer<typeof helpArticleSchema>;
