import type { DevRevHttpClient } from "../api/client.js";
import { DevRevHttpError } from "../api/client.js";
import { accountsCreate, accountsUpdate } from "../api/accounts.js";
import { articlesCreate } from "../api/articles.js";
import { devUsersSelf } from "../api/devUsers.js";
import { groupsCreate, groupsListPost } from "../api/groups.js";
import { incidentsCreate, incidentsUpdate } from "../api/incidents.js";
import { linksCreate } from "../api/links.js";
import { partsCreate, partsUpdate } from "../api/parts.js";
import { revOrgsCreate } from "../api/revOrgs.js";
import { revUsersCreate, revUsersUpdate } from "../api/revUsers.js";
import { listSprintsReferencedByWorks } from "../api/sprints.js";
import { customStagesCreate, customStagesListPost, discoverStateIds } from "../api/stages.js";
import { tagsCreate } from "../api/tags.js";
import { timelineEntriesCreate } from "../api/timelineEntries.js";
import { findWorkByExternalRef, worksCreate, worksUpdate } from "../api/works.js";
import { AuditLogger } from "../logging/audit.js";
import type { Plan, PlanStep } from "../types/plan.js";
import { loadManifest, saveManifest, type RunManifest } from "./manifest.js";
import { resolveDeep, resolveOwnedBy, resolveRefToken, type ResolveContext } from "./resolvers.js";

export type ExecutionSummary = {
  ok: number;
  failed: number;
  skipped: number;
  failures: { stepId: string; message: string }[];
};

function errMsg(e: unknown): string {
  if (e instanceof DevRevHttpError) return `${e.message}: ${e.bodyText.slice(0, 500)}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function pickPayload(step: PlanStep): Record<string, unknown> {
  return (step.payload ?? {}) as Record<string, unknown>;
}

/** Detect ticket vs issue from display_id or DON-style id paths. */
function isTicketWorkId(id: string): boolean {
  return /^TKT-/i.test(id) || id.includes(":ticket/");
}

function isIssueWorkId(id: string): boolean {
  return /^ISS-/i.test(id) || id.includes(":issue/");
}

function isTicketIssuePair(src: string, tgt: string): boolean {
  return (
    (isTicketWorkId(src) && isIssueWorkId(tgt)) || (isIssueWorkId(src) && isTicketWorkId(tgt))
  );
}

export async function resolveSelfDisplayId(client: DevRevHttpClient): Promise<string> {
  const self = await devUsersSelf(client);
  const id = self.dev_user?.display_id ?? self.dev_user?.id;
  if (!id) throw new Error("dev-users.self did not return dev_user.display_id or id");
  return id;
}

export type StepProgress = {
  stepIndex: number;
  totalSteps: number;
  stepId: string;
  title: string;
  status: "ok" | "skipped" | "failed";
  message?: string;
};

export async function executePlan(options: {
  plan: Plan;
  client: DevRevHttpClient;
  dryRun: boolean;
  outputDir: string;
  audit: AuditLogger;
  manifest?: RunManifest;
  /** When true, skip steps whose ids are already in `manifest.completed`. */
  resume?: boolean;
  /** Optional callback invoked after each step completes. */
  onStep?: (progress: StepProgress) => void;
}): Promise<ExecutionSummary> {
  const manifest = options.manifest ?? (await loadManifest(options.outputDir));
  const selfDisplayId = await resolveSelfDisplayId(options.client);
  const ctx: ResolveContext = { manifest, selfDisplayId };

  const summary: ExecutionSummary = { ok: 0, failed: 0, skipped: 0, failures: [] };
  const total = options.plan.steps.length;

  const persistManifest = async () => saveManifest(options.outputDir, manifest);

  for (let i = 0; i < options.plan.steps.length; i++) {
    const step = options.plan.steps[i];
    if (options.resume && manifest.completed[step.id]) {
      summary.skipped++;
      options.onStep?.({
        stepIndex: i, totalSteps: total, stepId: step.id,
        title: step.title ?? step.kind, status: "skipped", message: "resumed",
      });
      await options.audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: step.kind,
        status: "skipped",
        rationale: "resume: step already completed in a prior run",
      });
      continue;
    }
    try {
      const result = await executeOneStep({
        step,
        client: options.client,
        dryRun: options.dryRun,
        audit: options.audit,
        ctx,
      });
      if (result === "ok") {
        summary.ok++;
        // Only mark genuinely-mutating success as completed. Dry-run paths
        // return "skipped", so they won't accidentally pin completion state.
        if (!options.dryRun) manifest.completed[step.id] = true;
      } else if (result === "skipped") {
        summary.skipped++;
      }
      options.onStep?.({
        stepIndex: i, totalSteps: total, stepId: step.id,
        title: step.title ?? step.kind, status: result,
      });
      await persistManifest();
    } catch (e) {
      summary.failed++;
      const msg = errMsg(e);
      summary.failures.push({ stepId: step.id, message: msg });
      options.onStep?.({
        stepIndex: i, totalSteps: total, stepId: step.id,
        title: step.title ?? step.kind, status: "failed", message: msg,
      });
      await options.audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: step.kind,
        status: "failed",
        error: msg,
        rationale: step.rationale,
      });
      await persistManifest();
    }
  }

  await options.audit.log({
    ts: new Date().toISOString(),
    phase: "execute",
    status: "ok",
    response_summary: { execution_summary: summary },
  });

  return summary;
}

async function executeOneStep(params: {
  step: PlanStep;
  client: DevRevHttpClient;
  dryRun: boolean;
  audit: AuditLogger;
  ctx: ResolveContext;
}): Promise<"ok" | "skipped"> {
  const { step, client, dryRun, audit, ctx } = params;
  const payload = pickPayload(step);

  if (step.kind === "ui_guidance") {
    const lines = (payload.steps as string[] | undefined) ?? [];
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      status: "skipped",
      rationale: step.rationale,
      response_summary: { ui_steps: lines },
    });
    return "skipped";
  }

  if (step.kind === "noop") {
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      status: "skipped",
      rationale: step.rationale,
    });
    return "skipped";
  }

  if (step.kind === "list_sprints") {
    if (dryRun) {
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        status: "skipped",
        rationale: "dry-run",
      });
      return "skipped";
    }
    const sprints = await listSprintsReferencedByWorks(client);
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "works.list→aggregate",
      status: "ok",
      rationale: step.rationale,
      response_summary: AuditLogger.snapshot({ sprint_count: sprints.length, sprints }),
    });
    return "ok";
  }

  if (dryRun) {
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: step.kind,
      status: "skipped",
      rationale: "dry-run",
      request: AuditLogger.snapshot(payload),
    });
    return "skipped";
  }

  if (step.kind === "create_part") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    if (bodyRaw.parent_part === "__MISSING_PARENT_REF__") {
      throw new Error("Non-product part missing parent_ref in blueprint");
    }
    bodyRaw.owned_by = resolveOwnedBy(bodyRaw.owned_by, ctx) ?? bodyRaw.owned_by;
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    // Defensive guard: parts.create returns bad_request without owned_by — a
    // pattern reported by the DevRev CLI itself. The plan builder always
    // populates ["SELF"] today, but a corrupted plan or future entry point
    // shouldn't be able to slip through.
    if (!Array.isArray(body.owned_by) || body.owned_by.length === 0) {
      throw new Error(
        "create_part requires owned_by (DevRev parts.create rejects bad_request without it)",
      );
    }
    const res = await partsCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.part?.id) {
      ctx.manifest.refs[ref] = { id: res.part.id, display_id: res.part.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "parts.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.part ?? res),
    });
    return "ok";
  }

  if (step.kind === "update_part") {
    const patch = resolveDeep(payload.patch ?? {}, ctx) as Record<string, unknown>;
    const id =
      (payload.id as string | undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.display_id : undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.id : undefined);
    if (!id) throw new Error("update_part missing id");
    const res = await partsUpdate(client, { id, ...patch });
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "parts.update",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot({ id, ...patch }),
      response_summary: AuditLogger.snapshot(res.part ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_work") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    bodyRaw.owned_by = resolveOwnedBy(bodyRaw.owned_by, ctx) ?? bodyRaw.owned_by;
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    const ref = payload.manifest_ref as string | undefined;
    const externalRef = typeof body.external_ref === "string" ? body.external_ref : undefined;
    const workType = typeof body.type === "string" ? body.type : undefined;

    const reuseExisting = async (existing: { id?: string; display_id?: string }, note: string) => {
      if (ref && existing.id) {
        ctx.manifest.refs[ref] = { id: existing.id, display_id: existing.display_id };
      }
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "works.create",
        rationale: step.rationale,
        status: "ok",
        request: AuditLogger.snapshot(body),
        response_summary: AuditLogger.snapshot({ note, external_ref: externalRef, work: existing }),
      });
    };

    if (externalRef && workType) {
      const preExisting = await findWorkByExternalRef(client, workType, externalRef);
      if (preExisting?.id) {
        await reuseExisting(preExisting, "skipped_create_existing_external_ref");
        return "ok";
      }
    }

    try {
      const res = await worksCreate(client, body);
      if (ref && res.work?.id) {
        ctx.manifest.refs[ref] = { id: res.work.id, display_id: res.work.display_id };
      }
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "works.create",
        rationale: step.rationale,
        status: "ok",
        request: AuditLogger.snapshot(body),
        response_summary: AuditLogger.snapshot(res.work ?? res),
      });
      return "ok";
    } catch (e) {
      if (
        e instanceof DevRevHttpError &&
        e.status === 409 &&
        externalRef &&
        workType
      ) {
        const existing = await findWorkByExternalRef(client, workType, externalRef);
        if (existing?.id) {
          await reuseExisting(existing, "resolved_after_http_409_conflict");
          return "ok";
        }
      }
      throw e;
    }
  }

  if (step.kind === "update_work") {
    const patch = resolveDeep(payload.patch ?? {}, ctx) as Record<string, unknown>;
    const id =
      (payload.id as string | undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.display_id : undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.id : undefined);
    if (!id) throw new Error("update_work missing id");
    const res = await worksUpdate(client, { id, ...patch });
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "works.update",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot({ id, ...patch }),
      response_summary: AuditLogger.snapshot(res.work ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_incident") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    bodyRaw.owned_by = resolveOwnedBy(bodyRaw.owned_by, ctx) ?? bodyRaw.owned_by;
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    const res = await incidentsCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.incident?.id) {
      ctx.manifest.refs[ref] = { id: res.incident.id, display_id: res.incident.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "incidents.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.incident ?? res),
    });
    return "ok";
  }

  if (step.kind === "update_incident") {
    const patch = resolveDeep(payload.patch ?? {}, ctx) as Record<string, unknown>;
    const id =
      (payload.id as string | undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.display_id : undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.id : undefined);
    if (!id) throw new Error("update_incident missing id");
    const res = await incidentsUpdate(client, { id, ...patch });
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "incidents.update",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot({ id, ...patch }),
      response_summary: AuditLogger.snapshot(res.incident ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_link") {
    const src =
      resolveRefToken(payload.source, ctx) ??
      (typeof payload.source === "string" ? payload.source : undefined);
    const tgt =
      resolveRefToken(payload.target, ctx) ??
      (typeof payload.target === "string" ? payload.target : undefined);
    if (!src || !tgt) throw new Error("create_link missing source/target after ref resolution");
    const body: Record<string, unknown> = {
      source: src,
      target: tgt,
      link_type: payload.link_type ?? "is_related_to",
    };
    if (payload.custom_link_type) body.custom_link_type = payload.custom_link_type;
    try {
      const res = await linksCreate(client, body);
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "links.create",
        rationale: step.rationale,
        status: "ok",
        request: AuditLogger.snapshot(body),
        response_summary: AuditLogger.snapshot(res.link ?? res),
      });
    } catch (e) {
      const msg = errMsg(e);
      if (
        e instanceof DevRevHttpError &&
        e.status === 400 &&
        body.link_type === "is_related_to" &&
        isTicketIssuePair(src, tgt)
      ) {
        const alt = { ...body, link_type: "is_dependent_on" };
        try {
          const res = await linksCreate(client, alt);
          await audit.log({
            ts: new Date().toISOString(),
            step_id: step.id,
            phase: "execute",
            operation: "links.create",
            rationale: step.rationale,
            status: "ok",
            request: AuditLogger.snapshot({ attempted: body, succeeded_with: alt }),
            response_summary: AuditLogger.snapshot({
              note: "retried_is_related_to_as_is_dependent_on_for_ticket_issue_pairs",
              link: res.link ?? res,
            }),
          });
          return "ok";
        } catch (fallbackErr) {
          // Surface the fallback failure — it's more informative than the
          // original 400 since both link types failed.
          throw new Error(
            `links.create failed with both is_related_to (${errMsg(e)}) and is_dependent_on (${errMsg(fallbackErr)})`,
          );
        }
      }
      // Reverse fallback: is_dependent_on between same-type objects (e.g. ticket↔ticket)
      // often fails — retry with is_related_to.
      if (
        e instanceof DevRevHttpError &&
        e.status === 400 &&
        body.link_type === "is_dependent_on" &&
        !isTicketIssuePair(src, tgt)
      ) {
        const alt = { ...body, link_type: "is_related_to" };
        try {
          const res = await linksCreate(client, alt);
          await audit.log({
            ts: new Date().toISOString(),
            step_id: step.id,
            phase: "execute",
            operation: "links.create",
            rationale: step.rationale,
            status: "ok",
            request: AuditLogger.snapshot({ attempted: body, succeeded_with: alt }),
            response_summary: AuditLogger.snapshot({
              note: "retried_is_dependent_on_as_is_related_to_for_same_type_pairs",
              link: res.link ?? res,
            }),
          });
          return "ok";
        } catch (fallbackErr) {
          throw new Error(
            `links.create failed with both is_dependent_on (${errMsg(e)}) and is_related_to (${errMsg(fallbackErr)})`,
          );
        }
      }
      if (
        (e instanceof DevRevHttpError && e.status === 409) ||
        msg.includes("conflict") ||
        msg.toLowerCase().includes("duplicate")
      ) {
        await audit.log({
          ts: new Date().toISOString(),
          step_id: step.id,
          phase: "execute",
          operation: "links.create",
          status: "skipped",
          rationale: `Treating as duplicate/conflict: ${msg}`,
          request: AuditLogger.snapshot(body),
        });
        return "skipped";
      }
      throw e;
    }
    return "ok";
  }

  if (step.kind === "create_account") {
    const body = resolveDeep({ ...(payload.body as Record<string, unknown>) }, ctx) as Record<
      string,
      unknown
    >;
    const res = await accountsCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.account?.id) {
      ctx.manifest.refs[ref] = { id: res.account.id, display_id: res.account.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "accounts.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.account ?? res),
    });
    return "ok";
  }

  if (step.kind === "update_account") {
    const patch = resolveDeep(payload.patch ?? {}, ctx) as Record<string, unknown>;
    const id =
      (payload.id as string | undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.display_id : undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.id : undefined);
    if (!id) throw new Error("update_account missing id");
    const res = await accountsUpdate(client, { id, ...patch });
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "accounts.update",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot({ id, ...patch }),
      response_summary: AuditLogger.snapshot(res.account ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_rev_user") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    bodyRaw.rev_org =
      resolveRefToken(bodyRaw.rev_org, ctx) ?? resolveDeep(bodyRaw.rev_org, ctx) ?? bodyRaw.rev_org;
    bodyRaw.account =
      resolveRefToken(bodyRaw.account, ctx) ?? resolveDeep(bodyRaw.account, ctx) ?? bodyRaw.account;
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    const res = await revUsersCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.rev_user?.id) {
      ctx.manifest.refs[ref] = { id: res.rev_user.id, display_id: res.rev_user.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "rev-users.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.rev_user ?? res),
    });
    return "ok";
  }

  if (step.kind === "update_rev_user") {
    const patch = resolveDeep(payload.patch ?? {}, ctx) as Record<string, unknown>;
    const id =
      (payload.id as string | undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.display_id : undefined) ??
      (payload.manifest_ref ? ctx.manifest.refs[payload.manifest_ref as string]?.id : undefined);
    if (!id) throw new Error("update_rev_user missing id");
    const res = await revUsersUpdate(client, { id, ...patch });
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "rev-users.update",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot({ id, ...patch }),
      response_summary: AuditLogger.snapshot(res.rev_user ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_rev_org") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    const res = await revOrgsCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.rev_org?.id) {
      ctx.manifest.refs[ref] = { id: res.rev_org.id, display_id: res.rev_org.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "rev-orgs.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.rev_org ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_article") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    bodyRaw.owned_by = resolveOwnedBy(bodyRaw.owned_by, ctx) ?? bodyRaw.owned_by;
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    const res = await articlesCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.article?.id) {
      ctx.manifest.refs[ref] = { id: res.article.id, display_id: res.article.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "articles.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.article ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_tag") {
    const body = resolveDeep({ ...(payload.body as Record<string, unknown>) }, ctx) as Record<
      string,
      unknown
    >;
    const res = await tagsCreate(client, body);
    const ref = payload.manifest_ref as string | undefined;
    if (ref && res.tag?.id) {
      ctx.manifest.refs[ref] = { id: res.tag.id, display_id: res.tag.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "tags.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.tag ?? res),
    });
    return "ok";
  }

  if (step.kind === "create_custom_stage") {
    const body = resolveDeep({ ...(payload.body as Record<string, unknown>) }, ctx) as Record<
      string,
      unknown
    >;
    // DevRev's stages.custom.create expects `state` as a DON ID
    // (e.g. "don:core:…:custom_state/1"), not a friendly name like "open".
    // Lazily discover state IDs on first custom stage step, then cache.
    if (typeof body.state === "string" && !body.state.startsWith("don:")) {
      if (!ctx.stateIds) {
        ctx.stateIds = await discoverStateIds(client);
      }
      const stateId = ctx.stateIds.get(body.state);
      if (!stateId) {
        throw new Error(
          `Unknown stage state "${body.state}". Known states: ${[...ctx.stateIds.keys()].join(", ")}`,
        );
      }
      body.state = stateId;
    }
    const ref = payload.manifest_ref as string | undefined;
    const stageName = typeof body.name === "string" ? body.name : undefined;
    try {
      const res = await customStagesCreate(client, body);
      if (ref && res.custom_stage?.id) {
        ctx.manifest.refs[ref] = {
          id: res.custom_stage.id,
          display_id: res.custom_stage.display_id,
        };
      }
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "stages.custom.create",
        rationale: step.rationale,
        status: "ok",
        request: AuditLogger.snapshot(body),
        response_summary: AuditLogger.snapshot(res.custom_stage ?? res),
      });
      return "ok";
    } catch (e) {
      // DevRev rejects duplicate stage names with HTTP 400. Fall back to
      // finding the existing stage by name and reusing it in the manifest.
      if (e instanceof DevRevHttpError && e.status === 400 && stageName) {
        const listRes = await customStagesListPost(client, {});
        const existing = (listRes.result ?? []).find(
          (s) => typeof s.name === "string" && s.name.toLowerCase() === stageName.toLowerCase(),
        );
        if (existing?.id) {
          if (ref) {
            ctx.manifest.refs[ref] = { id: existing.id, display_id: existing.display_id };
          }
          await audit.log({
            ts: new Date().toISOString(),
            step_id: step.id,
            phase: "execute",
            operation: "stages.custom.create",
            rationale: step.rationale,
            status: "ok",
            request: AuditLogger.snapshot(body),
            response_summary: AuditLogger.snapshot({
              note: "reused_existing_stage_with_same_name",
              stage: existing,
            }),
          });
          return "ok";
        }
      }
      throw e;
    }
  }

  if (step.kind === "create_group") {
    const raw = resolveDeep({ ...(payload.body as Record<string, unknown>) }, ctx) as Record<
      string,
      unknown
    >;
    // DevRev groups.create requires: name (text), description (text).
    // Default type to "static" (manually-managed group) when not specified.
    // Strip undefined/null values to avoid sending empty keys the API may reject.
    const body: Record<string, unknown> = {};
    if (raw.name) body.name = raw.name;
    if (raw.description) {
      body.description = raw.description;
    } else if (typeof raw.name === "string") {
      body.description = raw.name;
    }
    body.type = raw.type ?? "static";
    if (Array.isArray(raw.members) && raw.members.length > 0) {
      body.members = raw.members;
    }

    let groupResult: { id?: string; display_id?: string } | undefined;
    try {
      const res = await groupsCreate(client, body);
      groupResult = res.group;
    } catch (e) {
      // DevRev returns HTTP 400 for duplicate group names. Fall back to
      // finding the existing group by name and reusing it (groups.delete
      // does not exist in the API, so duplicates from prior runs persist).
      if (e instanceof DevRevHttpError && e.status === 400 && typeof body.name === "string") {
        const listRes = await groupsListPost(client, {});
        const existing = (listRes.groups ?? []).find(
          (g) => g.name?.toLowerCase() === (body.name as string).toLowerCase(),
        );
        if (existing?.id) {
          groupResult = existing;
        } else {
          throw e; // genuinely invalid, not a duplicate
        }
      } else {
        throw e;
      }
    }

    const ref = payload.manifest_ref as string | undefined;
    if (ref && groupResult?.id) {
      ctx.manifest.refs[ref] = { id: groupResult.id, display_id: groupResult.display_id };
    }
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "groups.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(groupResult ?? {}),
    });
    return "ok";
  }

  if (step.kind === "create_vista") {
    const body = resolveDeep({ ...(payload.body as Record<string, unknown>) }, ctx) as Record<
      string,
      unknown
    >;
    const ref = payload.manifest_ref as string | undefined;
    const vistaName = typeof body.name === "string" ? body.name : undefined;

    try {
      const resp = await client.post("vistas.create", body);
      const vistaResult = (resp as Record<string, unknown>).vista as
        | { id?: string; display_id?: string }
        | undefined;
      if (ref && vistaResult?.id) {
        ctx.manifest.refs[ref] = { id: vistaResult.id, display_id: vistaResult.display_id };
      }
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "vistas.create",
        rationale: step.rationale,
        status: "ok",
        request: AuditLogger.snapshot(body),
        response_summary: AuditLogger.snapshot(vistaResult ?? {}),
      });
      return "ok";
    } catch (e) {
      if (e instanceof DevRevHttpError && (e.status === 409 || e.status === 400) && vistaName) {
        const listResp = await client.post("vistas.list", {}) as { vistas?: { id?: string; display_id?: string; name?: string }[] };
        const existing = (listResp.vistas ?? []).find(
          (v) => v.name?.toLowerCase() === vistaName.toLowerCase(),
        );
        if (existing?.id) {
          if (ref) {
            ctx.manifest.refs[ref] = { id: existing.id, display_id: existing.display_id };
          }
          await audit.log({
            ts: new Date().toISOString(),
            step_id: step.id,
            phase: "execute",
            operation: "vistas.create",
            rationale: step.rationale,
            status: "ok",
            request: AuditLogger.snapshot(body),
            response_summary: AuditLogger.snapshot({
              note: "reused_existing_vista_with_same_name",
              vista: existing,
            }),
          });
          return "ok";
        }
      }
      throw e;
    }
  }

  if (step.kind === "create_timeline_entry") {
    const bodyRaw = { ...(payload.body as Record<string, unknown>) };
    // The DevRev API expects `object` to be a string id. resolveDeep turns
    // any { __ref: "..." } into the resolved display_id/id.
    const body = resolveDeep(bodyRaw, ctx) as Record<string, unknown>;
    // If the parent ref didn't land in the manifest (typically because the
    // parent step failed earlier in this run), skip cleanly rather than
    // throwing a hard error. The earlier failure is the real one to chase.
    if (!body.object || typeof body.object !== "string") {
      const unresolvedRef =
        bodyRaw.object && typeof bodyRaw.object === "object" && "__ref" in bodyRaw.object
          ? (bodyRaw.object as { __ref: string }).__ref
          : "(unknown)";
      await audit.log({
        ts: new Date().toISOString(),
        step_id: step.id,
        phase: "execute",
        operation: "timeline-entries.create",
        status: "skipped",
        rationale: `Skipped: parent ref "${unresolvedRef}" not in manifest (parent step likely failed).`,
      });
      return "skipped";
    }
    const res = await timelineEntriesCreate(client, body);
    await audit.log({
      ts: new Date().toISOString(),
      step_id: step.id,
      phase: "execute",
      operation: "timeline-entries.create",
      rationale: step.rationale,
      status: "ok",
      request: AuditLogger.snapshot(body),
      response_summary: AuditLogger.snapshot(res.timeline_entry ?? res),
    });
    return "ok";
  }

  throw new Error(`Unsupported step kind in executor: ${step.kind}`);
}
