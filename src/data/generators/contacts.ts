import type { NormalizedRow } from "../../parsers/csv.js";
import type { Scenario } from "../scenarios/types.js";
import { fakeCompany, fakerFor } from "./util.js";

const CONTACTS_PER_ACCOUNT = 3;

/**
 * Generate contacts grouped under shared accounts. Pre-creates
 * `ceil(count / 3)` companies and round-robins contacts across them so each
 * account ends up with 2–4 contacts — realistic for B2B demos vs. the prior
 * "every contact has its own unique fake company" behavior.
 */
export function generateContacts(scenario: Scenario, count: number, seed?: number): NormalizedRow[] {
  const f = fakerFor(seed);
  const accountCount = Math.max(1, Math.ceil(count / CONTACTS_PER_ACCOUNT));
  const companies = Array.from({ length: accountCount }, () => fakeCompany(f, scenario));
  const rows: NormalizedRow[] = [];
  for (let i = 0; i < count; i++) {
    const first = f.person.firstName();
    const last = f.person.lastName();
    const company = companies[i % companies.length];
    const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
    const email = `${handle}@${company.domain}`;
    rows.push({
      display_name: `${first} ${last}`,
      email,
      phone: f.phone.number({ style: "international" }),
      account_name: company.name,
      external_ref: email,
    });
  }
  return rows;
}
