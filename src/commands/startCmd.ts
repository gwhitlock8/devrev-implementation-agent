import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { applyCommand } from "./applyCmd.js";
import { planCommand, type PlanCliArgs } from "./planCmd.js";

export type StartCliArgs = PlanCliArgs & {
  yes: boolean;
  dryRun: boolean;
  /** Stop after planning; do not apply. */
  planOnly: boolean;
};

// json is inherited from PlanCliArgs; passed through to applyCommand below.

async function confirmInteractive(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question("\nApply this plan against DevRev now? [y/N] "))
      .trim()
      .toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

export async function startCommand(args: StartCliArgs): Promise<void> {
  const planResult = await planCommand(args);

  if (args.planOnly) {
    if (!args.json) console.log("\n--plan-only set; stopping after plan.");
    return;
  }
  if (args.dryRun) {
    if (!args.json) console.log("\nDry-run: applying plan without DevRev mutations.");
    await applyCommand({
      outputDir: planResult.outputDir,
      dryRun: true,
      json: args.json,
    });
    return;
  }

  let proceed = args.yes;
  if (!proceed) {
    if (!process.stdin.isTTY) {
      console.error(
        "\nNot a TTY. Pass --yes to apply non-interactively, or run `devrev-impl-agent apply` later.",
      );
      process.exitCode = 1;
      return;
    }
    proceed = await confirmInteractive();
  }
  if (!proceed) {
    if (!args.json) {
      console.log(
        `\nNot applying. When ready, run: devrev-impl-agent apply --output-dir ${planResult.outputDir}`,
      );
    }
    return;
  }
  await applyCommand({ outputDir: planResult.outputDir, dryRun: false, json: args.json });
}
