import { z } from "zod";

import { isoDaySchema } from "./iso-date";

// Activity input (§5.2). Do not add fields that are not part of the design.

/** At most five related departments can be selected (§5.2, §16.2). */
export const MAX_TARGET_DEPARTMENTS = 5;

export const activityDateSchema = isoDaySchema();

/**
 * Text-length limits are loaded from settings and supplied to this schema
 * factory so client and server validation use the same values.
 *
 * The default minimum is one character: the field must not be empty. Higher
 * minimums are a company decision and are not imposed silently in code.
 */
export interface ActivityTextLimits {
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
}

/** Fallback ceiling used when settings cannot be loaded, such as for drafts. */
export const DEFAULT_TEXT_LIMITS: ActivityTextLimits = {
  titleMin: 1,
  titleMax: 150,
  descriptionMin: 1,
  descriptionMax: 10_000,
};

export function activityTitleSchema(limits: ActivityTextLimits) {
  return z
    .string()
    .trim()
    .min(
      limits.titleMin,
      limits.titleMin <= 1
        ? "Title is required"
        : `Title must be at least ${limits.titleMin} characters`,
    )
    .max(limits.titleMax, `Title must be ${limits.titleMax} characters or fewer`);
}

export function activityDescriptionSchema(limits: ActivityTextLimits) {
  return z
    .string()
    .trim()
    .min(
      limits.descriptionMin,
      limits.descriptionMin <= 1
        ? "Description is required"
        : `Description must be at least ${limits.descriptionMin} characters`,
    )
    .max(
      limits.descriptionMax,
      `Description must be ${limits.descriptionMax.toLocaleString("en-US")} characters or fewer`,
    );
}

export const targetDepartmentsSchema = z
  .array(z.string().uuid())
  .min(1, "Select at least one related department")
  .max(
    MAX_TARGET_DEPARTMENTS,
    `At most ${MAX_TARGET_DEPARTMENTS} related departments can be selected`,
  )
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A department cannot be selected more than once",
  });

export function createActivitySchema(limits: ActivityTextLimits) {
  return z.object({
    activityDate: activityDateSchema,
    title: activityTitleSchema(limits),
    description: activityDescriptionSchema(limits),
    targetDepartmentIds: targetDepartmentsSchema,
  });
}

export function updateActivitySchema(limits: ActivityTextLimits) {
  return createActivitySchema(limits).extend({ id: z.string().uuid() });
}

export type CreateActivityInput = z.infer<ReturnType<typeof createActivitySchema>>;
export type UpdateActivityInput = z.infer<ReturnType<typeof updateActivitySchema>>;
