import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { synthesizeBlueprintWithClaude, type PlannerEvent } from "../agent/planner.js";
import { loadEnvFiles, optionalEnv, requireEnv } from "../config/loadEnv.js";
import { pickModel } from "../util/modelPicker.js";
import { DEFAULT_ANTHROPIC_PLANNER_MODEL } from "../agent/planner.js";
import { DevRevMcpClient } from "../mcp/devrevClient.js";
import { buildPlanFromBlueprint } from "../plan/buildFromBlueprint.js";
import { formatPlanHuman } from "../plan/format.js";
import { detectDuplicatePartNames, type PreflightWarning } from "../plan/preflight.js";
import { loadBlueprintFile, type Blueprint } from "../parsers/blueprint.js";
import type { Plan } from "../types/plan.js";
import { Progress } from "../util/progress.js";
import { generateNarrative } from "../commands/narrativeCmd.js";

export const DEFAULT_OUTPUT_DIR = "poc-output";

export type PlanCliArgs = {
  prompt?: string;
  promptFile?: string;
  blueprint?: string;
  outputDir: string;
  /** When true, skip MCP `lookup_org` even if configured. */
  noMcp?: boolean;
  /** Emit a machine-readable summary on stdout instead of the human view. */
  json?: boolean;
  /**
   * Anthropic model to use for synthesis. When set to "pick" (or omitted on an
   * interactive TTY with --model flag but no value), shows an interactive picker.
   * Falls back to ANTHROPIC_MODEL env var, then the built-in default.
   */
  model?: string;
};

async function readPrompt(args: PlanCliArgs): Promise<string> {
  if (args.promptFile) {
    return (await readFile(args.promptFile, "utf8")).trim();
  }
  return (args.prompt ?? "").trim();
}

export type PlanResult = {
  blueprint: Blueprint;
  plan: Plan;
  outputDir: string;
  blueprintPath: string;
  planPath: string;
};

function summarizeToolInput(name: string, input: unknown): string {
  if (name === "lookup_org" && input && typeof input === "object" && "query" in input) {
    const q = String((input as { query: unknown }).query ?? "").slice(0, 80);
    return `lookup_org("${q}")`;
  }
  if (name === "submit_blueprint") return "submit_blueprint(...)";
  return `${name}(...)`;
}

function makePlannerProgressHandler(progress: Progress): (event: PlannerEvent) => void {
  return (event) => {
    switch (event.kind) {
      case "turn_start":
        progress.update(`Synthesizing blueprint with Claude (turn ${event.turn})`);
        break;
      case "tool_use":
        progress.info(`→ ${summarizeToolInput(event.name, event.input)}`);
        break;
      case "tool_result":
        if (!event.ok) progress.info(`  ✗ ${event.name}: ${event.preview ?? "failed"}`);
        break;
      case "blueprint_received":
        if (event.valid) progress.update("Blueprint received, validating");
        else progress.update("Blueprint invalid, asking Claude to retry");
        break;
      case "blueprint_invalid_retrying":
        for (const i of event.issues.slice(0, 3)) {
          progress.info(`  - ${i.path}: ${i.message}`);
        }
        break;
    }
  };
}

/**
 * Produce a blueprint (from NL prompt or an existing file) and a deterministic plan.
 * Used by both `plan` (stop here) and `start` (continue to apply).
 */
export async function planCommand(args: PlanCliArgs): Promise<PlanResult> {
  loadEnvFiles();
  await mkdir(args.outputDir, { recursive: true });
  const userPrompt = await readPrompt(args);

  let blueprint: Blueprint;
  let preflightWarnings: PreflightWarning[] = [];
  if (args.blueprint) {
    blueprint = await loadBlueprintFile(args.blueprint);
    if (userPrompt) {
      console.log(
        "Note: --blueprint was provided, so --prompt is ignored. Edit the blueprint to change the POC.",
      );
    }
  } else {
    if (!userPrompt) {
      throw new Error(
        'Provide a natural-language brief, e.g. plan "Stand up a POC for SaaS company Lumio with 3 products and 20 tickets". ' +
          "Or pass --blueprint to use an existing blueprint.json.",
      );
    }
    const apiKey = requireEnv("ANTHROPIC_API_KEY");
    const defaultModel = optionalEnv("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_PLANNER_MODEL;
    // "pick" triggers the interactive picker; any other value is used as-is;
    // undefined falls back to the env-var default.
    const model = args.model === "pick"
      ? await pickModel(defaultModel)
      : (args.model ?? defaultModel);
    const progress = new Progress();
    let mcp: DevRevMcpClient | null = null;
    if (!args.noMcp && process.env.DEVREV_PAT) {
      progress.start("Connecting to DevRev MCP");
      mcp = new DevRevMcpClient();
      try {
        await mcp.connect();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress.stop();
        console.warn(
          `DevRev MCP unavailable (${msg}). Continuing without lookup_org. ` +
            "Pass --no-mcp to silence this warning, or fix DEVREV_MCP_COMMAND.",
        );
        await mcp.close();
        mcp = null;
      }
    }
    progress.start("Synthesizing blueprint with Claude");
    try {
      blueprint = await synthesizeBlueprintWithClaude({
        userPrompt,
        apiKey,
        model,
        mcp,
        onEvent: makePlannerProgressHandler(progress),
      });
      progress.succeed("Blueprint synthesized");
      if (mcp) {
        progress.start("Pre-flight: checking for duplicate part names in the live org");
        try {
          preflightWarnings = await detectDuplicatePartNames(blueprint, mcp);
          if (preflightWarnings.length) {
            progress.succeed(
              `Pre-flight: ${preflightWarnings.length} duplicate part name(s) detected`,
            );
          } else {
            progress.succeed("Pre-flight: no duplicate part names");
          }
        } catch {
          progress.stop();
          // Pre-flight is advisory; never fail the plan over it.
        }
      }
    } catch (e) {
      progress.fail("Blueprint synthesis failed");
      throw e;
    } finally {
      if (mcp) await mcp.close();
    }
  }

  const blueprintPath = join(args.outputDir, "blueprint.json");
  await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2), "utf8");

  const buildProgress = new Progress();
  buildProgress.start("Building deterministic plan");
  const built = await buildPlanFromBlueprint(blueprint, { outputDir: args.outputDir });
  buildProgress.succeed(`Plan built (${built.plan.steps.length} step${built.plan.steps.length === 1 ? "" : "s"})`);

  if (built.refIssues.length > 0) {
    const summary = built.refIssues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(`Blueprint has unresolved refs:\n${summary}`);
  }
  const allWarnings = [...built.lintIssues, ...preflightWarnings];
  if (allWarnings.length > 0) {
    console.warn("\nBlueprint warnings:");
    for (const w of allWarnings) console.warn(`  - ${w.path}: ${w.message}`);
  }

  const planPath = join(args.outputDir, "plan.json");
  await writeFile(planPath, JSON.stringify(built.plan, null, 2), "utf8");

  // Auto-generate the demo narrative runbook alongside the plan
  const narrativePath = join(args.outputDir, "demo-narrative.md");
  const blueprintFile = args.blueprint ? basename(args.blueprint) : "blueprint.json";
  const narrativeMarkdown = generateNarrative(blueprint, {
    title: blueprint.name ?? blueprintFile.replace(/\.json$/, ""),
    persona: "Sales Engineer",
    blueprintFile,
    includeCleanup: true,
  });
  await writeFile(narrativePath, narrativeMarkdown, "utf8");

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        blueprintPath,
        planPath,
        narrativePath,
        outputDir: args.outputDir,
        stepCount: built.plan.steps.length,
        title: built.plan.title,
        warnings: allWarnings,
      })}\n`,
    );
  } else {
    console.log(formatPlanHuman(built.plan));
    console.log(`\nWrote blueprint:  ${blueprintPath}`);
    console.log(`Wrote plan:       ${planPath}`);
    console.log(`Wrote narrative:  ${narrativePath}`);
    if (built.imports.some((i) => i.source_path.startsWith(join(args.outputDir, "generated")))) {
      console.log(`Generated CSVs:   ${join(args.outputDir, "generated")}`);
    }
  }
  return { blueprint, plan: built.plan, outputDir: args.outputDir, blueprintPath, planPath };
}
