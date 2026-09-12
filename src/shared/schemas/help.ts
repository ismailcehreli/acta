import { z } from "zod";

const plainText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), {
      message: `${label} cannot contain HTML tags`,
    });

export const helpArticleSchema = z.object({
  category: plainText("Category", 60),
  title: plainText("Title", 200),
  answer: plainText("Answer", 10000),
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
