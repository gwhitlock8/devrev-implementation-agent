import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateCsv } from "../data/index.js";
import { SCENARIO_NAMES, type ScenarioName } from "../parsers/blueprint.js";
import type { CsvEntity } from "../parsers/csv.js";

export type GenerateCliArgs = {
  scenario: string;
  entity: string;
  rows: number;
  seed?: number;
  /** Path to write the CSV. If omitted, writes to stdout. */
  output?: string;
};

const ENTITIES: CsvEntity[] = ["contacts", "accounts", "tickets", "issues", "articles"];

function isScenario(s: string): s is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(s);
}

function isEntity(s: string): s is CsvEntity {
  return (ENTITIES as readonly string[]).includes(s);
}

export async function generateCommand(args: GenerateCliArgs): Promise<void> {
  if (!isScenario(args.scenario)) {
    throw new Error(
      `Unknown scenario "${args.scenario}". Available: ${SCENARIO_NAMES.join(", ")}`,
    );
  }
  if (!isEntity(args.entity)) {
    throw new Error(`Unknown entity "${args.entity}". Available: ${ENTITIES.join(", ")}`);
  }
  const csv = generateCsv({
    scenario: args.scenario,
    entity: args.entity,
    count: args.rows,
    seed: args.seed,
  });
  if (args.output) {
    await mkdir(dirname(args.output) || ".", { recursive: true });
    await writeFile(args.output, csv, "utf8");
    console.log(`Wrote ${args.rows} ${args.entity} rows to ${args.output}`);
  } else {
    process.stdout.write(csv);
  }
}
