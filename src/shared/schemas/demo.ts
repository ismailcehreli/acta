import { z } from "zod";

export const demoObjectOriginSchema = z.enum([
  "CREATED_BY_INSTALLER",
  "REUSED_EXISTING",
]);

export const classifyLegacyDemoOriginsSchema = z
  .object({
    selections: z
      .array(
        z.object({
          orgUnitId: z.string().uuid("Invalid unit ID"),
          origin: demoObjectOriginSchema,
        }),
      )
      .min(1, "Select at least one unit")
      .max(50, "At most 50 units can be classified in one operation"),
  })
  .superRefine(({ selections }, ctx) => {
    const ids = selections.map((selection) => selection.orgUnitId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selections"],
        message: "A unit cannot be submitted more than once",
      });
    }
  });

export type DemoObjectOriginInput = z.infer<typeof demoObjectOriginSchema>;
export type ClassifyLegacyDemoOriginsInput = z.infer<
  typeof classifyLegacyDemoOriginsSchema
>;
