import type { NormalizedRow } from "../../parsers/csv.js";
import type { Scenario } from "../scenarios/types.js";
import { fakeCompany, fakerFor } from "./util.js";

export function generateAccounts(scenario: Scenario, count: number, seed?: number): NormalizedRow[] {
  const f = fakerFor(seed);
  const rows: NormalizedRow[] = [];
  for (let i = 0; i < count; i++) {
    const company = fakeCompany(f, scenario);
    rows.push({
      display_name: company.name,
      account_name: company.name,
      domains: company.domain,
      body: f.company.catchPhrase(),
      external_ref: company.slug,
    });
  }
  return rows;
}
