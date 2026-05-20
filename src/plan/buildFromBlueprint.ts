import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  lintBlueprintLinks,
  lintRevUserRevOrg,
  validateBlueprintRefs,
  type Blueprint,
  type CsvBinding,
} from "../parsers/blueprint.js";
import {
  mapRowHeaders,
  parseCsvFileWithMeta,
  type CsvEntity,
  type NormalizedRow,
} from "../parsers/csv.js";
import type { Plan, PlanStep } from "../types/plan.js";
import { generateRows, rowsToCsv } from "../data/index.js";
import { generateConversations } from "../data/generators/conversations.js";
import { getScenario } from "../data/scenarios/index.js";
import {
  dashboardsGuidance,
  emailChannelsGuidance,
  integrationsGuidance,
  plugGuidance,
  prerequisitesGuidance,
  slaGuidance,
} from "../templates/configurations.js";

export type CsvImport = {
  source_path: string;
  entity: CsvEntity;
  rows: NormalizedRow[];
  column_map?: Record<string, string>;
};

export type BuildPlanOptions = {
  /**
   * If set, generator-backed CSV bindings write resolved CSVs into this
   * directory (under `generated/<entity>.csv`) so the user has a record of
   * what data the run is based on.
   */
  outputDir?: string;
  /**
   * If true, validation issues become a thrown error. If false, they're returned
   * in `lintIssues` for the caller to surface.
   */
  strict?: boolean;
};

export type BuildPlanResult = {
  plan: Plan;
  /** CSVs the builder materialized (from generator bindings or paths). */
  imports: CsvImport[];
  /** Non-fatal issues (e.g. ticket↔issue link_type mismatch warnings). */
  lintIssues: { path: string; message: string }[];
  /** Hard validation issues (broken refs, etc.). Throws when `strict` is true. */
  refIssues: { path: string; message: string }[];
};

function step(id: string, partial: Omit<PlanStep, "id">): PlanStep {
  return { id, ...partial };
}

/**
 * DevRev's works.create accepts priority differently per work type
 * (validated 2026-05-07 against a real tenant):
 *
 *   - tickets: `severity` as a string enum: "blocker" | "high" | "medium" | "low"
 *   - issues:  `priority_v2` as a numeric enum: 1=P0, 2=P1, 3=P2, 4=P3
 *
 * Blueprint authors still use friendly p0..p3 strings; the plan builder
 * picks the right field name + value type based on `type`.
 */
const PRIORITY_V2_MAP: Record<string, number> = { p0: 1, p1: 2, p2: 3, p3: 4 };
const SEVERITY_MAP: Record<string, "blocker" | "high" | "medium" | "low"> = {
  p0: "blocker",
  p1: "high",
  p2: "medium",
  p3: "low",
};

function priorityV2(p: string | undefined): number | undefined {
  if (!p) return undefined;
  return PRIORITY_V2_MAP[p.toLowerCase()];
}

function severityFromPriority(p: string | undefined): string | undefined {
  if (!p) return undefined;
  return SEVERITY_MAP[p.toLowerCase()];
}

/** Apply the right priority/severity field based on work type. */
function workPriorityFields(
  type: string,
  priority: string | undefined,
): Record<string, unknown> {
  if (type === "ticket") {
    const s = severityFromPriority(priority);
    return s ? { severity: s } : {};
  }
  if (type === "issue") {
    const v = priorityV2(priority);
    return v !== undefined ? { priority_v2: v } : {};
  }
  return {};
}

async function resolveCsvBinding(
  binding: CsvBinding,
  outputDir: string | undefined,
): Promise<CsvImport> {
  if (binding.generator === "faker") {
    if (!binding.scenario || !binding.count) {
      throw new Error("Generator binding missing scenario or count");
    }
    const rows = generateRows({
      scenario: binding.scenario,
      entity: binding.entity,
      count: binding.count,
      seed: binding.seed,
    });
    let writtenPath = `generated:${binding.scenario}/${binding.entity}.csv`;
    if (outputDir) {
      const dir = join(outputDir, "generated");
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${binding.entity}.csv`);
      await writeFile(path, rowsToCsv(rows, binding.entity), "utf8");
      writtenPath = path;
    }
    return {
      source_path: writtenPath,
      entity: binding.entity,
      rows,
      column_map: binding.column_map,
    };
  }
  if (!binding.path) throw new Error("CSV binding missing path");
  const parsed = await parseCsvFileWithMeta(binding.path);
  if (parsed.source !== "unknown") {
    // Log to stderr (stdout stays clean for piped consumers).
    console.error(
      `Detected ${parsed.source} CSV format in ${binding.path} — applying column mapping automatically.`,
    );
  }
  return {
    source_path: binding.path,
    entity: binding.entity,
    rows: parsed.rows,
    column_map: binding.column_map,
  };
}

export async function resolveCsvBindings(
  blueprint: Blueprint,
  outputDir?: string,
): Promise<CsvImport[]> {
  const out: CsvImport[] = [];
  for (const b of blueprint.csv ?? []) {
    out.push(await resolveCsvBinding(b, outputDir));
  }
  return out;
}

/**
 * Build a deterministic plan from a blueprint.
 *
 * `csvImports` is optional — if omitted, the builder resolves them from the
 * blueprint's `csv[]` bindings (including generator-backed ones).
 */
export async function buildPlanFromBlueprint(
  blueprint: Blueprint,
  csvImportsOrOptions?: CsvImport[] | BuildPlanOptions,
  maybeOptions?: BuildPlanOptions,
): Promise<BuildPlanResult> {
  let csvImports: CsvImport[] | undefined;
  let options: BuildPlanOptions | undefined;
  if (Array.isArray(csvImportsOrOptions)) {
    csvImports = csvImportsOrOptions;
    options = maybeOptions;
  } else {
    options = csvImportsOrOptions ?? maybeOptions;
  }
  if (!csvImports) {
    csvImports = await resolveCsvBindings(blueprint, options?.outputDir);
  }

  const refIssues = validateBlueprintRefs(blueprint);
  const lintIssues = [...lintBlueprintLinks(blueprint), ...lintRevUserRevOrg(blueprint)];
  if (options?.strict && refIssues.length > 0) {
    const summary = refIssues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(`Blueprint has unresolved refs:\n${summary}`);
  }

  const steps: PlanStep[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const ownedByDefault = blueprint.defaults?.owned_by;

  if (blueprint.options?.include_sprint_discovery) {
    steps.push(
      step(nextId("sprint"), {
        kind: "list_sprints",
        title: "Discover sprints referenced by existing issues",
        rationale:
          "Aggregates sprint objects returned on work items from works.list (may omit sprints with zero issues).",
        payload: {},
      }),
    );
  }

  for (const p of blueprint.parts ?? []) {
    const body: Record<string, unknown> = {
      type: p.type,
      name: p.name,
      description: p.description,
      owned_by: p.owned_by ?? ownedByDefault ?? ["SELF"],
    };
    if (p.type !== "product") {
      // DevRev parts.create expects parent_part as a single string ID, not an
      // array. Validated 2026-05-07: array shape returns `unexpected_json_type`.
      body.parent_part = p.parent_ref ? { __ref: p.parent_ref } : "__MISSING_PARENT_REF__";
    }
    steps.push(
      step(nextId("part"), {
        kind: "create_part",
        title: `Create ${p.type}: ${p.name}`,
        rationale: p.ref
          ? `Blueprint part${p.parent_ref ? ` (parent ref: ${p.parent_ref})` : ""}`
          : `Blueprint part`,
        payload: {
          manifest_ref: p.ref,
          parent_ref: p.parent_ref,
          body,
        },
      }),
    );
  }

  // KB articles. Confirmed via curl (2026-05-08) against a real tenant:
  //   - articles.create accepts: title, owned_by, resource: { url }
  //   - articles.create rejects: external_ref, body, description, content,
  //     resource.content, resource.{type,text}, applies_to_part
  //   - resource accepts ONLY `{ url }` — inline body isn't a writable shape.
  //
  // Implication: articles in the agent are URL-backed (when blueprint has
  // `resource_url`) or empty metadata-only shells (default). Body content
  // is added via the DevRev UI after apply; the blueprint's `body` field is
  // preserved for SE clarity but never reaches the API.
  for (const a of blueprint.articles ?? []) {
    steps.push(
      step(nextId("art"), {
        kind: "create_article",
        title: `Create article: ${a.title}`,
        rationale: a.ref ? `Blueprint article ref=${a.ref}` : "Blueprint article",
        payload: {
          manifest_ref: a.ref,
          body: {
            title: a.title,
            owned_by: a.owned_by ?? ownedByDefault ?? ["SELF"],
            resource: a.resource_url ? { url: a.resource_url } : {},
          },
        },
      }),
    );
  }

  for (const w of blueprint.works ?? []) {
    steps.push(
      step(nextId("work"), {
        kind: "create_work",
        title: `Create ${w.type}: ${w.title}`,
        rationale: w.ref ? `Blueprint work ref=${w.ref}` : `Blueprint work`,
        payload: {
          manifest_ref: w.ref,
          body: {
            type: w.type,
            title: w.title,
            body: w.body,
            applies_to_part:
              w.applies_to_part ??
              (w.applies_to_part_ref ? { __ref: w.applies_to_part_ref } : undefined),
            owned_by: w.owned_by ?? ownedByDefault ?? ["SELF"],
            external_ref: w.external_ref,
            ...workPriorityFields(w.type, w.priority),
          },
        },
      }),
    );
  }

  for (const inc of blueprint.incidents ?? []) {
    steps.push(
      step(nextId("inc"), {
        kind: "create_incident",
        title: `Create incident: ${inc.title}`,
        rationale: inc.ref ? `Blueprint incident ref=${inc.ref}` : `Blueprint incident`,
        payload: {
          manifest_ref: inc.ref,
          body: {
            title: inc.title,
            body: inc.body,
            applies_to_parts:
              inc.applies_to_parts ??
              (inc.applies_to_part_refs?.length
                ? inc.applies_to_part_refs.map((r) => ({ __ref: r }))
                : undefined),
            owned_by: inc.owned_by ?? ownedByDefault ?? ["SELF"],
          },
        },
      }),
    );
  }

  for (const a of blueprint.accounts ?? []) {
    steps.push(
      step(nextId("acc"), {
        kind: "create_account",
        title: `Create account: ${a.display_name}`,
        rationale: a.ref ? `Blueprint account ref=${a.ref}` : `Blueprint account`,
        payload: {
          manifest_ref: a.ref,
          body: {
            display_name: a.display_name,
            description: a.description,
            domains: a.domains,
          },
        },
      }),
    );
  }

  for (const ro of blueprint.rev_orgs ?? []) {
    steps.push(
      step(nextId("revorg"), {
        kind: "create_rev_org",
        title: `Create rev org: ${ro.display_name}`,
        rationale: ro.ref ? `Blueprint rev_org ref=${ro.ref}` : "Blueprint rev_org",
        payload: {
          manifest_ref: ro.ref,
          body: {
            display_name: ro.display_name,
            account: ro.account ?? (ro.account_ref ? { __ref: ro.account_ref } : undefined),
            external_ref: ro.external_ref,
            domains: ro.domains,
          },
        },
      }),
    );
  }

  for (const u of blueprint.account_updates ?? []) {
    steps.push(
      step(nextId("accup"), {
        kind: "update_account",
        title: `Update account ${u.ref ?? u.id ?? ""}`,
        rationale: `Blueprint account update`,
        payload: {
          manifest_ref: u.ref,
          id: u.id,
          patch: u.patch,
        },
      }),
    );
  }

  for (const ru of blueprint.rev_users ?? []) {
    steps.push(
      step(nextId("ru"), {
        kind: "create_rev_user",
        title: `Create contact (rev user): ${ru.display_name ?? ru.email ?? ru.external_ref ?? ""}`,
        rationale: ru.ref ? `Blueprint rev user ref=${ru.ref}` : `Blueprint rev user`,
        payload: {
          manifest_ref: ru.ref,
          body: {
            rev_org:
              ru.rev_org ??
              (ru.rev_org_ref ? { __ref: ru.rev_org_ref } : blueprint.defaults?.rev_org),
            account:
              ru.account ?? (ru.account_ref ? { __ref: ru.account_ref } : undefined),
            email: ru.email,
            display_name: ru.display_name,
            external_ref: ru.external_ref,
            external_refs: ru.external_refs,
            phone_numbers: ru.phone_numbers,
          },
        },
      }),
    );
  }

  for (const ruu of blueprint.rev_user_updates ?? []) {
    steps.push(
      step(nextId("ruup"), {
        kind: "update_rev_user",
        title: `Update rev user ${ruu.ref ?? ruu.id ?? ""}`,
        rationale: `Blueprint rev user update`,
        payload: {
          manifest_ref: ruu.ref,
          id: ruu.id,
          patch: ruu.patch,
        },
      }),
    );
  }

  // Tags — created early so they can be referenced by works/articles later.
  for (const tag of blueprint.tags ?? []) {
    steps.push(
      step(nextId("tag"), {
        kind: "create_tag",
        title: `Create tag: ${tag.name}`,
        rationale: tag.ref ? `Blueprint tag ref=${tag.ref}` : "Blueprint tag",
        payload: {
          manifest_ref: tag.ref,
          body: {
            name: tag.name,
            description: tag.description,
          },
        },
      }),
    );
  }

  // Custom stages — ticket/issue lifecycle stages.
  for (const cs of blueprint.custom_stages ?? []) {
    steps.push(
      step(nextId("stage"), {
        kind: "create_custom_stage",
        title: `Create custom stage: ${cs.name} (${cs.state}, ordinal ${cs.ordinal})`,
        rationale: cs.ref ? `Blueprint custom stage ref=${cs.ref}` : "Blueprint custom stage",
        payload: {
          manifest_ref: cs.ref,
          body: {
            name: cs.name,
            description: cs.description,
            state: cs.state,
            ordinal: cs.ordinal,
          },
        },
      }),
    );
  }

  // Groups — support teams, escalation groups, etc.
  for (const g of blueprint.groups ?? []) {
    steps.push(
      step(nextId("group"), {
        kind: "create_group",
        title: `Create group: ${g.name}`,
        rationale: g.ref ? `Blueprint group ref=${g.ref}` : "Blueprint group",
        payload: {
          manifest_ref: g.ref,
          body: {
            name: g.name,
            description: g.description,
            ...(g.members && g.members.length > 0 ? { members: g.members } : {}),
          },
        },
      }),
    );
  }

  // Vistas (saved views)
  for (const v of blueprint.vistas ?? []) {
    steps.push(
      step(nextId("vista"), {
        kind: "create_vista",
        title: `Create vista: ${v.name}`,
        rationale: v.ref ? `Blueprint vista ref=${v.ref}` : "Blueprint vista",
        payload: {
          manifest_ref: v.ref,
          body: {
            name: v.name,
            type: v.type ?? "dynamic",
            filter_type: v.filter_type ?? "works",
            filter: v.filter,
          },
        },
      }),
    );
  }

  for (const link of blueprint.links ?? []) {
    steps.push(
      step(nextId("link"), {
        kind: "create_link",
        title: `Link objects (${link.link_type ?? "is_related_to"})`,
        rationale: link.rationale ?? `Blueprint link`,
        payload: {
          source: link.source ?? (link.source_ref ? { __ref: link.source_ref } : undefined),
          target: link.target ?? (link.target_ref ? { __ref: link.target_ref } : undefined),
          link_type: link.link_type ?? "is_related_to",
          custom_link_type: link.custom_link_type,
        },
      }),
    );
  }

  // Candidate part refs for auto-attaching generated tickets/issues that don't
  // already have an applies_to_part. Prefer leaf-ish parts (features and
  // enhancements) since those are typically what tickets/issues attach to;
  // fall back to any part with a ref.
  const leafPartRefs = (blueprint.parts ?? [])
    .filter((p) => p.ref && (p.type === "feature" || p.type === "enhancement"))
    .map((p) => p.ref!);
  const fallbackPartRefs = (blueprint.parts ?? []).filter((p) => p.ref).map((p) => p.ref!);
  const candidatePartRefs = leafPartRefs.length ? leafPartRefs : fallbackPartRefs;
  let workPartIdx = 0;

  // Track every work ref that exists in the plan (blueprint + CSV) so the
  // optional `generate_conversations` block can attach timeline entries to
  // each ticket without the SE having to enumerate them.
  const blueprintWorkRefs = (blueprint.works ?? [])
    .filter((w) => w.ref)
    .map((w) => w.ref!);
  const csvWorkRefs: string[] = [];

  for (const imp of csvImports) {
    let r = 0;
    for (const rawRow of imp.rows) {
      r++;
      const row = mapRowHeaders(rawRow, imp.column_map);
      const rid = `${imp.entity}-${r}`;
      if (imp.entity === "contacts") {
        steps.push(
          step(nextId("csv-contact"), {
            kind: "create_rev_user",
            title: `CSV contact row ${r} (${imp.source_path})`,
            rationale: `Imported from CSV as customer contact`,
            payload: {
              body: {
                rev_org: row.rev_org ?? blueprint.defaults?.rev_org,
                account: row.account,
                email: row.email,
                display_name: row.display_name,
                external_ref: row.external_ref ?? row.email,
                phone_numbers: row.phone ? [row.phone] : undefined,
              },
            },
          }),
        );
      } else if (imp.entity === "accounts") {
        steps.push(
          step(nextId("csv-acc"), {
            kind: "create_account",
            title: `CSV account row ${r} (${imp.source_path})`,
            rationale: `Imported from CSV`,
            payload: {
              body: {
                display_name: row.display_name || row.account_name || `Account ${rid}`,
                description: row.body,
                domains: row.domains ? row.domains.split(/[;,]/).map((s) => s.trim()) : undefined,
              },
            },
          }),
        );
      } else if (imp.entity === "tickets" || imp.entity === "issues") {
        // Resolve applies_to_part with this precedence:
        //   1. row's own applies_to_part (string id)
        //   2. blueprint.defaults.applies_to_part
        //   3. round-robin across blueprint leaf parts (as a __ref token)
        let appliesToPart: unknown = row.applies_to_part;
        if (!appliesToPart && blueprint.defaults?.applies_to_part) {
          appliesToPart = blueprint.defaults.applies_to_part;
        }
        if (!appliesToPart && candidatePartRefs.length) {
          const ref = candidatePartRefs[workPartIdx % candidatePartRefs.length];
          workPartIdx++;
          appliesToPart = { __ref: ref };
        }
        // Synthesize a manifest_ref for CSV-imported works so downstream
        // primitives (timeline entries, links) can attach to them.
        const csvWorkRef = `csv:${imp.entity === "tickets" ? "tic" : "iss"}:${r}`;
        csvWorkRefs.push(csvWorkRef);
        steps.push(
          step(nextId("csv-work"), {
            kind: "create_work",
            title: `CSV ${imp.entity} row ${r}: ${row.title ?? rid}`,
            rationale: `Imported from CSV`,
            payload: {
              manifest_ref: csvWorkRef,
              body: {
                type: imp.entity === "tickets" ? "ticket" : "issue",
                title: row.title || `${imp.entity} ${rid}`,
                body: row.body,
                applies_to_part: appliesToPart,
                owned_by: ownedByDefault ?? ["SELF"],
                external_ref: row.external_ref,
                ...workPriorityFields(imp.entity === "tickets" ? "ticket" : "issue", row.priority),
              },
            },
          }),
        );
      } else if (imp.entity === "articles") {
        const ref = `csv:art:${r}`;
        const url = row.resource_url || row.url;
        steps.push(
          step(nextId("csv-art"), {
            kind: "create_article",
            title: `CSV article row ${r}: ${row.title ?? rid}`,
            rationale: "Imported from CSV",
            payload: {
              manifest_ref: ref,
              body: {
                title: row.title || `Article ${rid}`,
                owned_by: ownedByDefault ?? ["SELF"],
                resource: url ? { url } : {},
              },
            },
          }),
        );
      }
    }
  }

  // Timeline entries: explicit blueprint entries, then auto-generated comments
  // from `generate_conversations` (if set). Auto-generated entries attach to
  // every blueprint + CSV-imported work ref, optionally capped via
  // `for_first_n_tickets`.
  for (const t of blueprint.timeline_entries ?? []) {
    steps.push(
      step(nextId("tle"), {
        kind: "create_timeline_entry",
        title: `Timeline entry on ${t.object_ref ?? t.object ?? "?"}`,
        rationale: "Blueprint timeline entry",
        payload: {
          body: {
            object: t.object ?? (t.object_ref ? { __ref: t.object_ref } : undefined),
            body: t.body,
            type: t.type ?? "timeline_comment",
            visibility: t.visibility ?? "external",
          },
        },
      }),
    );
  }
  if (blueprint.generate_conversations) {
    const spec = blueprint.generate_conversations;
    let targets = [...blueprintWorkRefs, ...csvWorkRefs];
    if (spec.for_first_n_tickets) targets = targets.slice(0, spec.for_first_n_tickets);
    if (targets.length > 0) {
      const scenario = getScenario(spec.scenario);
      const entries = generateConversations(
        scenario,
        targets,
        spec.per_ticket ?? 2,
        spec.seed,
      );
      for (const e of entries) {
        steps.push(
          step(nextId("tle-gen"), {
            kind: "create_timeline_entry",
            title: `Auto-comment on ${e.object_ref}`,
            rationale: `Generated conversation (${spec.scenario}, per_ticket=${spec.per_ticket ?? 2})`,
            payload: {
              body: {
                object: { __ref: e.object_ref },
                body: e.body,
                type: "timeline_comment",
                visibility: e.visibility,
              },
            },
          }),
        );
      }
    }
  }

  const uiSections: { title: string; doc_links?: string[]; steps: string[] }[] = (
    blueprint.ui_guidance ?? []
  ).map((g) => ({
    title: g.title,
    doc_links: g.doc_links,
    steps: g.steps,
  }));

  // C-2 configuration primitives → ui_guidance translation. Each block is
  // pure UI in DevRev today, so the agent's value is a tight, accurate
  // playbook rather than direct API automation. When any of these is set,
  // prepend a single Prerequisites section listing role/permissions
  // requirements — "access required" errors are the most common SE pain
  // point per the field reports.
  const hasC2Primitive = Boolean(
    blueprint.sla_policies?.length ||
      blueprint.email_channels?.length ||
      blueprint.plug_config ||
      blueprint.integrations?.length ||
      blueprint.dashboards?.length,
  );
  if (hasC2Primitive) {
    uiSections.unshift(prerequisitesGuidance());
  }
  if (blueprint.sla_policies?.length) {
    uiSections.push(slaGuidance(blueprint.sla_policies));
  }
  if (blueprint.email_channels?.length) {
    uiSections.push(emailChannelsGuidance(blueprint.email_channels));
  }
  if (blueprint.plug_config) {
    uiSections.push(plugGuidance(blueprint.plug_config));
  }
  if (blueprint.integrations?.length) {
    uiSections.push(...integrationsGuidance(blueprint.integrations));
  }
  if (blueprint.dashboards?.length) {
    uiSections.push(dashboardsGuidance(blueprint.dashboards));
  }

  const plan: Plan = {
    version: 1,
    title: blueprint.name ?? "DevRev implementation plan",
    summary: blueprint.description,
    ui_guidance_sections: uiSections.length ? uiSections : undefined,
    steps,
  };

  // ensure outputDir parent dir is consistent if caller passed it (no-op when undefined)
  if (options?.outputDir) {
    await mkdir(dirname(options.outputDir) || ".", { recursive: true });
  }

  return { plan, imports: csvImports, lintIssues, refIssues };
}
