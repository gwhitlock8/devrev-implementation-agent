import type { NormalizedRow } from "../../parsers/csv.js";
import type { Scenario } from "../scenarios/types.js";
import { fakerFor, pickWeighted } from "./util.js";

function makeRows(
  titles: string[],
  scenario: Scenario,
  count: number,
  seed: number | undefined,
  prefix: string,
): NormalizedRow[] {
  const f = fakerFor(seed);
  const rows: NormalizedRow[] = [];
  for (let i = 0; i < count; i++) {
    const title = titles[i % titles.length];
    const variant = i >= titles.length ? ` (${f.word.adjective()})` : "";
    const priority = pickWeighted(f, scenario.priorityWeights);
    rows.push({
      title: `${title}${variant}`,
      body: f.lorem.paragraph({ min: 2, max: 4 }),
      priority,
      external_ref: `${prefix}-${i + 1}`,
    });
  }
  return rows;
}

export function generateTickets(scenario: Scenario, count: number, seed?: number): NormalizedRow[] {
  return makeRows(scenario.ticketTitles, scenario, count, seed, "tic");
}

export function generateIssues(scenario: Scenario, count: number, seed?: number): NormalizedRow[] {
  return makeRows(scenario.issueTitles, scenario, count, seed, "iss");
}
