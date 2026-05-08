#!/usr/bin/env node
import { Command } from "commander";
import { applyCommand } from "./commands/applyCmd.js";
import { cleanupCommand } from "./commands/cleanupCmd.js";
import { doctorCommand } from "./commands/doctor.js";
import { generateCommand } from "./commands/generateCmd.js";
import { mcpServeCommand } from "./commands/mcpServeCmd.js";
import { planCommand, DEFAULT_OUTPUT_DIR } from "./commands/planCmd.js";
import { startCommand } from "./commands/startCmd.js";
import { verifyCommand } from "./commands/verifyCmd.js";
import { loadEnvFiles } from "./config/loadEnv.js";
import { SCENARIO_NAMES } from "./parsers/blueprint.js";

loadEnvFiles();

const program = new Command();
program
  .name("dia")
  .description("Dia — your DevRev implementation engineer. Blueprint → plan → apply → cleanup.")
  .version("0.2.0")
  .option("--verbose", "Print stack traces for unhandled errors", false);

program
  .command("start")
  .argument("[brief...]", "Natural-language brief describing the POC")
  .description("One-shot: NL brief → blueprint → plan → confirm → apply")
  .option("--prompt-file <path>", "Read brief from a file instead of args")
  .option("-b, --blueprint <path>", "Power-user override: use an existing blueprint.json")
  .option("-o, --output-dir <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("-y, --yes", "Apply without interactive confirmation", false)
  .option("--plan-only", "Stop after plan; do not apply", false)
  .option("--dry-run", "Apply in dry-run mode (no DevRev mutations)", false)
  .option("--no-mcp", "Skip the DevRev MCP lookup_org tool during planning")
  .option("--json", "Emit a machine-readable summary instead of the human view", false)
  .action(async (briefParts: string[], opts) => {
    await startCommand({
      prompt: briefParts.length ? briefParts.join(" ") : undefined,
      promptFile: opts.promptFile,
      blueprint: opts.blueprint,
      outputDir: opts.outputDir,
      yes: Boolean(opts.yes),
      planOnly: Boolean(opts.planOnly),
      dryRun: Boolean(opts.dryRun),
      noMcp: opts.mcp === false,
      json: Boolean(opts.json),
    });
  });

program
  .command("plan")
  .argument("[brief...]", "Natural-language brief describing the POC")
  .description("Synthesize a blueprint and plan, but do not apply")
  .option("--prompt-file <path>", "Read brief from a file instead of args")
  .option("-b, --blueprint <path>", "Use an existing blueprint.json instead of NL synthesis")
  .option("-o, --output-dir <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
  .option("--no-mcp", "Skip the DevRev MCP lookup_org tool during planning")
  .option("--json", "Emit a machine-readable summary instead of the human view", false)
  .action(async (briefParts: string[], opts) => {
    await planCommand({
      prompt: briefParts.length ? briefParts.join(" ") : undefined,
      promptFile: opts.promptFile,
      blueprint: opts.blueprint,
      outputDir: opts.outputDir,
      noMcp: opts.mcp === false,
      json: Boolean(opts.json),
    });
  });

program
  .command("apply")
  .description("Execute the most recent plan in --output-dir against DevRev")
  .option("--plan <path>", "Explicit plan.json path (default: <output-dir>/plan.json)")
  .option("-o, --output-dir <dir>", "Plan / logs / manifest directory", DEFAULT_OUTPUT_DIR)
  .option("--dry-run", "Print what would happen without DevRev mutations", false)
  .option(
    "--resume",
    "Skip steps that already completed in a prior apply (per run-manifest.json)",
    false,
  )
  .option("--json", "Emit the execution summary as JSON instead of human text", false)
  .action(async (opts) => {
    await applyCommand({
      planFile: opts.plan,
      outputDir: opts.outputDir,
      dryRun: Boolean(opts.dryRun),
      resume: Boolean(opts.resume),
      json: Boolean(opts.json),
    });
  });

program
  .command("generate")
  .argument("<scenario>", `Scenario preset (${SCENARIO_NAMES.join(" | ")})`)
  .description("Emit a faker-generated CSV for an entity")
  .option(
    "-e, --entity <kind>",
    "contacts | accounts | tickets | issues | articles",
    "contacts",
  )
  .option("-r, --rows <n>", "Row count", (v: string) => Number(v), 25)
  .option("-s, --seed <n>", "Faker seed (deterministic output)", (v: string) => Number(v))
  .option("-o, --output <path>", "Write to file (default: stdout)")
  .action(async (scenario: string, opts) => {
    await generateCommand({
      scenario,
      entity: opts.entity,
      rows: opts.rows,
      seed: opts.seed,
      output: opts.output,
    });
  });

program
  .command("verify")
  .description("Use the DevRev MCP to confirm every manifest entry exists in the org")
  .option("-o, --output-dir <dir>", "Plan / manifest directory", DEFAULT_OUTPUT_DIR)
  .action(async (opts) => {
    await verifyCommand({ outputDir: opts.outputDir });
  });

program
  .command("mcp-serve")
  .description("Run as a DevRev MCP server over stdio (used by `lookup_org` and `verify`)")
  .action(async () => {
    await mcpServeCommand();
  });

program
  .command("cleanup")
  .description("Delete all objects created by the most recent apply (reads the manifest)")
  .option("-o, --output-dir <dir>", "Manifest / logs directory", DEFAULT_OUTPUT_DIR)
  .option("--dry-run", "Print what would be deleted without making any API calls", false)
  .option("--keep-parts", "Keep the product hierarchy (products, capabilities, features, enhancements)", false)
  .option("--json", "Emit the cleanup summary as JSON", false)
  .action(async (opts) => {
    await cleanupCommand({
      outputDir: opts.outputDir,
      dryRun: Boolean(opts.dryRun),
      keepParts: Boolean(opts.keepParts),
      json: Boolean(opts.json),
    });
  });

program
  .command("doctor")
  .description("Check DevRev PAT, Anthropic key, and DevRev MCP connectivity")
  .action(async () => {
    await doctorCommand();
  });

program.parseAsync(process.argv).catch((e) => {
  const verbose = Boolean(program.opts().verbose);
  if (verbose && e instanceof Error && e.stack) {
    console.error(e.stack);
  } else {
    console.error(e instanceof Error ? e.message : e);
  }
  process.exitCode = 1;
});
