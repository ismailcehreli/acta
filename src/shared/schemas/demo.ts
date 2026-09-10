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
          orgUnitId: z.string().uuid("Geçersiz birim kimliği"),
          origin: demoObjectOriginSchema,
        }),
      )
      .min(1, "En az bir birim sınıflandırılmalı")
      .max(50, "Tek işlemde en fazla 50 birim sınıflandırılabilir"),
  })
  .superRefine(({ selections }, ctx) => {
    const ids = selections.map((selection) => selection.orgUnitId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selections"],
        message: "Aynı birim birden fazla kez gönderilemez",
      });
    }
  });

export type DemoObjectOriginInput = z.infer<typeof demoObjectOriginSchema>;
export type ClassifyLegacyDemoOriginsInput = z.infer<
  typeof classifyLegacyDemoOriginsSchema
>;

