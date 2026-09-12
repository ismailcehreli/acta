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

export const feedbackCategorySchema = z.enum([
  "BUG",
  "SUGGESTION",
  "CRITIQUE",
  "QUESTION",
]);

export const feedbackStatusSchema = z.enum(["NEW", "IN_REVIEW", "RESOLVED"]);

export const feedbackCreateSchema = z.object({
  category: feedbackCategorySchema,
  title: plainText("Title", 200),
  description: plainText("Description", 10000),
  sourcePath: z
    .string()
    .trim()
    .max(500, "Page path is too long")
    .optional()
    .transform((value) => value || null),
  // All records are managed by system administrators. The field remains
  // accepted for compatibility with older clients but is not shown to users.
  adminsOnly: z.boolean().default(false),
});

export const feedbackUpdateSchema = z.object({
  id: z.string().uuid(),
  status: feedbackStatusSchema,
  response: z
    .string()
    .trim()
    .max(5000, "Response must be 5,000 characters or fewer")
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), {
      message: "Response cannot contain HTML tags",
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
