import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DevRevHttpClient } from "../api/client.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";
import { executePlan } from "../executor/runner.js";
import { AuditLogger } from "../logging/audit.js";
import { parsePlanJson, type Plan } from "../types/plan.js";
import { DEFAULT_OUTPUT_DIR } from "./planCmd.js";

export type ApplyCliArgs = {
  /** Optional explicit plan file. When omitted, reads `<outputDir>/plan.json`. */
  planFile?: string;
  outputDir?: string;
  dryRun: boolean;
  /** When true, skip steps that completed in a prior run (per the manifest). */
  resume?: boolean;
  /** Emit the execution summary as JSON instead of human text. */
  json?: boolean;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function applyCommand(args: ApplyCliArgs): Promise<void> {
  loadEnvFiles();
  const outputDir = args.outputDir ?? DEFAULT_OUTPUT_DIR;
  const planPath = args.planFile ?? join(outputDir, "plan.json");
  if (!(await fileExists(planPath))) {
    throw new Error(
      `No plan found at ${planPath}. Run \`devrev-impl-agent plan "<brief>"\` first or pass --plan <path>.`,
    );
  }

  const pat = requireEnv("DEVREV_PAT");
  const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
  const text = await readFile(planPath, "utf8");
  const plan = parsePlanJson(text) as Plan;

  const audit = new AuditLogger(outputDir);
  await audit.init();

  const client = new DevRevHttpClient({ pat, betaScope: beta });

  const summary = await executePlan({
    plan,
    client,
    dryRun: args.dryRun,
    outputDir,
    audit,
    resume: args.resume,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    console.log("\nExecution summary:", summary);
    if (summary.failures.length) {
      console.error("\nFailures:");
      for (const f of summary.failures) {
        console.error(`- ${f.stepId}: ${f.message}`);
      }
    }
  }
  if (summary.failures.length) process.exitCode = 1;
}
