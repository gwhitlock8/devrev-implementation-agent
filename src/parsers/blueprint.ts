import { readFile } from "node:fs/promises";
import { z } from "zod";

const LinkBlueprintSchema = z.object({
  source_ref: z.string().optional(),
  target_ref: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
  link_type: z.string().optional(),
  custom_link_type: z.string().optional(),
  rationale: z.string().optional(),
});

const PartBlueprintSchema = z.object({
  ref: z.string().optional(),
  type: z.enum(["product", "capability", "feature", "enhancement", "linkable", "runnable"]),
  name: z.string(),
  description: z.string().optional(),
  parent_ref: z.string().optional(),
  owned_by: z.array(z.string()).optional(),
});

const WorkBlueprintSchema = z.object({
  ref: z.string().optional(),
  type: z.enum(["issue", "ticket", "task", "opportunity"]),
  title: z.string(),
  body: z.string().optional(),
  applies_to_part: z.string().optional(),
  applies_to_part_ref: z.string().optional(),
  owned_by: z.array(z.string()).optional(),
  external_ref: z.string().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
});

const IncidentBlueprintSchema = z.object({
  ref: z.string().optional(),
  title: z.string(),
  body: z.string().optional(),
  applies_to_parts: z.array(z.string()).optional(),
  applies_to_part_refs: z.array(z.string()).optional(),
  owned_by: z.array(z.string()).optional(),
});

const AccountBlueprintSchema = z.object({
  ref: z.string().optional(),
  display_name: z.string(),
  description: z.string().optional(),
  domains: z.array(z.string()).optional(),
});

const AccountUpdateBlueprintSchema = z.object({
  ref: z.string().optional(),
  id: z.string().optional(),
  patch: z.record(z.unknown()),
});

const RevUserBlueprintSchema = z.object({
  ref: z.string().optional(),
  rev_org: z.string().optional(),
  rev_org_ref: z.string().optional(),
  account: z.string().optional(),
  account_ref: z.string().optional(),
  email: z.string().optional(),
  display_name: z.string().optional(),
  external_ref: z.string().optional(),
  external_refs: z.array(z.string()).optional(),
  phone_numbers: z.array(z.string()).optional(),
});

const RevUserUpdateBlueprintSchema = z.object({
  ref: z.string().optional(),
  id: z.string().optional(),
  patch: z.record(z.unknown()),
});

export const SCENARIO_NAMES = ["saas-support", "b2b-sales", "dev-tooling"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const CSV_ENTITIES = ["contacts", "accounts", "tickets", "issues", "articles"] as const;
export type CsvEntityName = (typeof CSV_ENTITIES)[number];

const CsvBindingSchema = z
  .object({
    path: z.string().optional(),
    entity: z.enum(CSV_ENTITIES),
    column_map: z.record(z.string()).optional(),
    generator: z.literal("faker").optional(),
    scenario: z.enum(SCENARIO_NAMES).optional(),
    count: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
  })
  .refine((b) => Boolean(b.path) || Boolean(b.generator), {
    message: "csv binding must declare either `path` or `generator: 'faker'`",
  })
  .refine((b) => !b.generator || (b.scenario && b.count), {
    message: "csv binding with `generator: 'faker'` requires `scenario` and `count`",
  });

const ArticleBlueprintSchema = z.object({
  ref: z.string().optional(),
  title: z.string(),
  /**
   * Body content for SE clarity / future use. Not sent to the API today —
   * DevRev's articles.create rejects inline body fields (validated 2026-05-08).
   * The SE pastes this into the article via the UI after apply, OR set
   * `resource_url` to point at an externally-hosted version of the content.
   */
  body: z.string().optional(),
  /**
   * URL the article references. When set, the plan builder sends
   * `resource: { url }` to articles.create — the only `resource` shape DevRev
   * accepts today. Use this for KB articles whose canonical content lives in
   * Confluence, a Help Center, or a public docs site.
   */
  resource_url: z.string().url().optional(),
  applies_to_part_ref: z.string().optional(),
  applies_to_part: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  language: z.string().optional(),
  external_ref: z.string().optional(),
  owned_by: z.array(z.string()).optional(),
});

const TimelineEntryBlueprintSchema = z.object({
  /** Either object_ref (resolved against blueprint refs) or object (raw id). */
  object_ref: z.string().optional(),
  object: z.string().optional(),
  body: z.string(),
  type: z.string().optional(),
  visibility: z.enum(["external", "internal", "private"]).optional(),
});

const GenerateConversationsSchema = z.object({
  scenario: z.enum(SCENARIO_NAMES),
  per_ticket: z.number().int().positive().max(20).default(2),
  /** Optional cap. By default applies to every generated/blueprint ticket. */
  for_first_n_tickets: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
});

const RevOrgBlueprintSchema = z.object({
  ref: z.string().optional(),
  display_name: z.string(),
  account: z.string().optional(),
  account_ref: z.string().optional(),
  external_ref: z.string().optional(),
  /**
   * Optional list of email domains the rev org owns. Strongly recommended:
   * without it the rev org exists but doesn't auto-associate inbound emails
   * from that domain (per DevRev's email-routing behavior).
   */
  domains: z.array(z.string()).optional(),
});

const PriorityKey = z.enum(["p0", "p1", "p2", "p3"]);
const SlaTargetMap = z.record(PriorityKey, z.string());
const SlaPolicyBlueprintSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  applies_to: z.string().optional(),
  targets: z.object({
    first_response: SlaTargetMap.optional(),
    resolution: SlaTargetMap.optional(),
  }),
  escalation: z.string().optional(),
});

const EmailChannelBlueprintSchema = z.object({
  address: z.string(),
  keyword_routing: z
    .array(z.object({ keyword: z.string(), route_to: z.string() }))
    .optional(),
  auto_acknowledge: z.boolean().optional(),
});

const PlugConfigBlueprintSchema = z.object({
  welcome_message: z.string().optional(),
  primary_color: z.string().optional(),
  ai_agent_enabled: z.boolean().optional(),
  fallback_to_ticket: z.boolean().optional(),
  ai_grounding_notes: z.string().optional(),
});

const INTEGRATION_KEYS = [
  "slack",
  "jira",
  "salesforce",
  "freshdesk",
  "hubspot",
  "whatsapp",
  "zendesk",
  "feature_request_handler",
] as const;
const IntegrationKeyEnum = z.enum(INTEGRATION_KEYS);
const IntegrationItemSchema = z.union([
  IntegrationKeyEnum,
  z.object({ name: IntegrationKeyEnum, notes: z.string().optional() }),
]);

export const BlueprintSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  options: z
    .object({
      include_sprint_discovery: z.boolean().optional(),
    })
    .optional(),
  defaults: z
    .object({
      owned_by: z.array(z.string()).optional(),
      rev_org: z.string().optional(),
      applies_to_part: z.string().optional(),
    })
    .optional(),
  parts: z.array(PartBlueprintSchema).optional(),
  works: z.array(WorkBlueprintSchema).optional(),
  incidents: z.array(IncidentBlueprintSchema).optional(),
  links: z.array(LinkBlueprintSchema).optional(),
  accounts: z.array(AccountBlueprintSchema).optional(),
  account_updates: z.array(AccountUpdateBlueprintSchema).optional(),
  rev_users: z.array(RevUserBlueprintSchema).optional(),
  rev_user_updates: z.array(RevUserUpdateBlueprintSchema).optional(),
  rev_orgs: z.array(RevOrgBlueprintSchema).optional(),
  articles: z.array(ArticleBlueprintSchema).optional(),
  timeline_entries: z.array(TimelineEntryBlueprintSchema).optional(),
  generate_conversations: GenerateConversationsSchema.optional(),
  sla_policies: z.array(SlaPolicyBlueprintSchema).optional(),
  email_channels: z.array(EmailChannelBlueprintSchema).optional(),
  plug_config: PlugConfigBlueprintSchema.optional(),
  integrations: z.array(IntegrationItemSchema).optional(),
  csv: z.array(CsvBindingSchema).optional(),
  ui_guidance: z
    .array(
      z.object({
        title: z.string(),
        steps: z.array(z.string()),
        doc_links: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type CsvBinding = z.infer<typeof CsvBindingSchema>;

export class BlueprintValidationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "BlueprintValidationError";
  }
}

function formatZodIssues(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((iss) => ({
    path: iss.path.length ? iss.path.join(".") : "(root)",
    message: iss.message,
  }));
}

export function parseBlueprint(raw: unknown): Blueprint {
  const result = BlueprintSchema.safeParse(raw);
  if (!result.success) {
    const issues = formatZodIssues(result.error);
    const summary = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new BlueprintValidationError(`Blueprint failed schema validation:\n${summary}`, issues);
  }
  return result.data;
}

export async function loadBlueprintFile(path: string): Promise<Blueprint> {
  const text = await readFile(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse JSON in ${path}: ${msg}`);
  }
  return parseBlueprint(raw);
}

/**
 * Walk every blueprint *_ref field and confirm it points at a defined ref in the same blueprint.
 * Catches typos at plan-time instead of letting them fail mid-apply.
 */
export function validateBlueprintRefs(bp: Blueprint): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const partRefs = new Set<string>();
  const workRefs = new Set<string>();
  const accountRefs = new Set<string>();
  const revUserRefs = new Set<string>();
  const incidentRefs = new Set<string>();
  const revOrgRefs = new Set<string>();
  const allRefs = new Set<string>();

  for (const p of bp.parts ?? []) if (p.ref) {
    partRefs.add(p.ref);
    allRefs.add(p.ref);
  }
  for (const w of bp.works ?? []) if (w.ref) {
    workRefs.add(w.ref);
    allRefs.add(w.ref);
  }
  for (const a of bp.accounts ?? []) if (a.ref) {
    accountRefs.add(a.ref);
    allRefs.add(a.ref);
  }
  for (const ru of bp.rev_users ?? []) if (ru.ref) {
    revUserRefs.add(ru.ref);
    allRefs.add(ru.ref);
  }
  for (const inc of bp.incidents ?? []) if (inc.ref) {
    incidentRefs.add(inc.ref);
    allRefs.add(inc.ref);
  }
  for (const ro of bp.rev_orgs ?? []) if (ro.ref) {
    revOrgRefs.add(ro.ref);
    allRefs.add(ro.ref);
  }

  // Build a ref → type lookup so we can enforce DevRev's parts hierarchy.
  // DevRev rejects features parented to a product, capabilities parented to
  // a non-product, etc.
  const partTypeByRef = new Map<string, string>();
  for (const p of bp.parts ?? []) if (p.ref) partTypeByRef.set(p.ref, p.type);

  (bp.parts ?? []).forEach((p, i) => {
    if (p.parent_ref && !partRefs.has(p.parent_ref)) {
      issues.push({
        path: `parts[${i}].parent_ref`,
        message: `unknown part ref "${p.parent_ref}" (define it in parts[].ref first)`,
      });
      return;
    }
    if (p.type === "product") {
      if (p.parent_ref) {
        issues.push({
          path: `parts[${i}].parent_ref`,
          message: `products cannot have a parent_ref (top-level only)`,
        });
      }
      return;
    }
    if (!p.parent_ref) {
      issues.push({
        path: `parts[${i}].parent_ref`,
        message: `${p.type} requires a parent_ref (DevRev rejects orphaned non-product parts)`,
      });
      return;
    }
    const parentType = partTypeByRef.get(p.parent_ref);
    if (p.type === "capability" && parentType !== "product") {
      issues.push({
        path: `parts[${i}].parent_ref`,
        message: `capability "${p.name}" must parent to a product (got ${parentType ?? "unknown"})`,
      });
    } else if (p.type === "feature" && parentType !== "capability") {
      issues.push({
        path: `parts[${i}].parent_ref`,
        message: `feature "${p.name}" must parent to a capability, not ${parentType ?? "unknown"} — DevRev rejects features under products directly`,
      });
    } else if (
      p.type === "enhancement" &&
      parentType !== "capability" &&
      parentType !== "feature"
    ) {
      issues.push({
        path: `parts[${i}].parent_ref`,
        message: `enhancement "${p.name}" must parent to a capability or feature (got ${parentType ?? "unknown"})`,
      });
    }
  });
  (bp.works ?? []).forEach((w, i) => {
    if (w.applies_to_part_ref && !partRefs.has(w.applies_to_part_ref)) {
      issues.push({
        path: `works[${i}].applies_to_part_ref`,
        message: `unknown part ref "${w.applies_to_part_ref}"`,
      });
    }
  });
  (bp.incidents ?? []).forEach((inc, i) => {
    for (const r of inc.applies_to_part_refs ?? []) {
      if (!partRefs.has(r)) {
        issues.push({
          path: `incidents[${i}].applies_to_part_refs`,
          message: `unknown part ref "${r}"`,
        });
      }
    }
  });
  (bp.rev_users ?? []).forEach((ru, i) => {
    if (ru.account_ref && !accountRefs.has(ru.account_ref)) {
      issues.push({
        path: `rev_users[${i}].account_ref`,
        message: `unknown account ref "${ru.account_ref}"`,
      });
    }
    if (ru.rev_org_ref && !revOrgRefs.has(ru.rev_org_ref)) {
      issues.push({
        path: `rev_users[${i}].rev_org_ref`,
        message: `unknown rev_org ref "${ru.rev_org_ref}"`,
      });
    }
  });
  (bp.rev_orgs ?? []).forEach((ro, i) => {
    if (ro.account_ref && !accountRefs.has(ro.account_ref)) {
      issues.push({
        path: `rev_orgs[${i}].account_ref`,
        message: `unknown account ref "${ro.account_ref}"`,
      });
    }
  });
  (bp.links ?? []).forEach((l, i) => {
    if (l.source_ref && !allRefs.has(l.source_ref)) {
      issues.push({
        path: `links[${i}].source_ref`,
        message: `unknown ref "${l.source_ref}" (must match a parts/works/accounts/rev_users/incidents ref)`,
      });
    }
    if (l.target_ref && !allRefs.has(l.target_ref)) {
      issues.push({
        path: `links[${i}].target_ref`,
        message: `unknown ref "${l.target_ref}"`,
      });
    }
  });
  (bp.articles ?? []).forEach((a, i) => {
    if (a.applies_to_part_ref && !partRefs.has(a.applies_to_part_ref)) {
      issues.push({
        path: `articles[${i}].applies_to_part_ref`,
        message: `unknown part ref "${a.applies_to_part_ref}"`,
      });
    }
  });
  (bp.timeline_entries ?? []).forEach((t, i) => {
    if (t.object_ref && !workRefs.has(t.object_ref)) {
      issues.push({
        path: `timeline_entries[${i}].object_ref`,
        message: `unknown work ref "${t.object_ref}" (timeline entries must attach to a tickets/issues ref)`,
      });
    }
  });

  return issues;
}

const TICKET_ISSUE_LINK_TYPE_MISMATCH =
  'links between a ticket and an issue should use link_type "is_dependent_on"; "is_related_to" returns HTTP 400 in DevRev';

/** Heuristics that warn about known DevRev quirks before they fail at apply time. */
export function lintBlueprintLinks(bp: Blueprint): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const workTypeByRef = new Map<string, string>();
  for (const w of bp.works ?? []) if (w.ref) workTypeByRef.set(w.ref, w.type);

  (bp.links ?? []).forEach((l, i) => {
    if ((l.link_type ?? "is_related_to") !== "is_related_to") return;
    const s = l.source_ref ? workTypeByRef.get(l.source_ref) : undefined;
    const t = l.target_ref ? workTypeByRef.get(l.target_ref) : undefined;
    if ((s === "ticket" && t === "issue") || (s === "issue" && t === "ticket")) {
      issues.push({
        path: `links[${i}].link_type`,
        message: TICKET_ISSUE_LINK_TYPE_MISMATCH,
      });
    }
  });
  return issues;
}

/**
 * Warn when rev_users may end up unable to participate in tickets.
 *
 * DevRev silently drops the `reporter` field on a ticket when the rev_user's
 * rev_org doesn't match the ticket's rev_org — and rev_users currently support
 * single-rev_org membership. This lint surfaces two known traps at plan time:
 *
 *   1. rev_users defined without any rev_org assignment (no per-user
 *      `rev_org_ref` AND no blueprint-level `defaults.rev_org`). Tickets
 *      reported by these users will likely lose the reporter.
 *   2. A rev_user whose rev_org_ref points at a rev_org owned by an
 *      account_ref that doesn't match the rev_user's own account_ref.
 */
export function lintRevUserRevOrg(bp: Blueprint): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const revOrgAccountByRef = new Map<string, string | undefined>();
  for (const ro of bp.rev_orgs ?? []) {
    if (ro.ref) revOrgAccountByRef.set(ro.ref, ro.account_ref);
  }
  const defaultRevOrg = bp.defaults?.rev_org;

  (bp.rev_users ?? []).forEach((ru, i) => {
    const hasOrg = Boolean(ru.rev_org || ru.rev_org_ref || defaultRevOrg);
    if (!hasOrg) {
      issues.push({
        path: `rev_users[${i}]`,
        message:
          "rev_user has no rev_org assignment — DevRev silently drops the reporter field on tickets when rev_user/ticket rev_org pair doesn't match. Set defaults.rev_org or per-user rev_org_ref.",
      });
    }
    if (ru.rev_org_ref && ru.account_ref) {
      const orgAccount = revOrgAccountByRef.get(ru.rev_org_ref);
      if (orgAccount && orgAccount !== ru.account_ref) {
        issues.push({
          path: `rev_users[${i}]`,
          message: `rev_user.account_ref "${ru.account_ref}" does not match the account_ref "${orgAccount}" of rev_org "${ru.rev_org_ref}" — DevRev rev_users currently support single-rev_org membership and cross-account membership is silently rejected.`,
        });
      }
    }
  });
  return issues;
}
