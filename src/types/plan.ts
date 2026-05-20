import { z } from "zod";

export const PlanStepKindSchema = z.enum([
  "ui_guidance",
  "create_part",
  "update_part",
  "create_work",
  "update_work",
  "create_incident",
  "update_incident",
  "create_link",
  "update_account",
  "create_account",
  "create_rev_user",
  "update_rev_user",
  "create_rev_org",
  "create_article",
  "create_timeline_entry",
  "create_tag",
  "create_custom_stage",
  "create_group",
  "create_vista",
  "list_sprints",
  "noop",
]);

export type PlanStepKind = z.infer<typeof PlanStepKindSchema>;

export const PlanStepSchema = z.object({
  id: z.string(),
  kind: PlanStepKindSchema,
  title: z.string(),
  rationale: z.string(),
  /** DevRev JSON body or patch object depending on kind */
  payload: z.record(z.unknown()).optional(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanSchema = z.object({
  version: z
    .union([z.literal(1), z.literal("1")])
    .transform(() => 1 as const),
  title: z.string(),
  summary: z.string().optional(),
  /** Manual steps for capabilities not covered by API automation */
  ui_guidance_sections: z
    .array(
      z.object({
        title: z.string(),
        doc_links: z.array(z.string()).optional(),
        steps: z.array(z.string()),
      }),
    )
    .optional(),
  steps: z.array(PlanStepSchema),
});

export type Plan = z.infer<typeof PlanSchema>;

export function parsePlanJson(text: string): Plan {
  const raw: unknown = JSON.parse(text);
  return PlanSchema.parse(raw);
}
