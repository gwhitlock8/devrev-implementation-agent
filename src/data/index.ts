import Papa from "papaparse";
import type { CsvEntity, NormalizedRow } from "../parsers/csv.js";
import type { ScenarioName } from "../parsers/blueprint.js";
import { getScenario } from "./scenarios/index.js";
import { generateAccounts } from "./generators/accounts.js";
import { generateArticles } from "./generators/articles.js";
import { generateContacts } from "./generators/contacts.js";
import { generateIssues, generateTickets } from "./generators/works.js";

export type GenerateOptions = {
  scenario: ScenarioName;
  entity: CsvEntity;
  count: number;
  seed?: number;
};

export function generateRows(opts: GenerateOptions): NormalizedRow[] {
  const scenario = getScenario(opts.scenario);
  switch (opts.entity) {
    case "contacts":
      return generateContacts(scenario, opts.count, opts.seed);
    case "accounts":
      return generateAccounts(scenario, opts.count, opts.seed);
    case "tickets":
      return generateTickets(scenario, opts.count, opts.seed);
    case "issues":
      return generateIssues(scenario, opts.count, opts.seed);
    case "articles":
      return generateArticles(scenario, opts.count, opts.seed);
  }
}

const HEADERS_BY_ENTITY: Record<CsvEntity, string[]> = {
  contacts: ["display_name", "email", "phone", "account_name", "external_ref"],
  accounts: ["display_name", "domains", "body", "external_ref"],
  tickets: ["title", "body", "priority", "external_ref"],
  issues: ["title", "body", "priority", "external_ref"],
  articles: ["title", "body", "status", "language", "external_ref"],
};

export function rowsToCsv(rows: NormalizedRow[], entity: CsvEntity): string {
  const headers = HEADERS_BY_ENTITY[entity];
  const records = rows.map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) o[h] = r[h] ?? "";
    return o;
  });
  return Papa.unparse(records, { columns: headers });
}

export function generateCsv(opts: GenerateOptions): string {
  const rows = generateRows(opts);
  return rowsToCsv(rows, opts.entity);
}
