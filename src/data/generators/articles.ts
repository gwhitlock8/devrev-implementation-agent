import type { NormalizedRow } from "../../parsers/csv.js";
import type { Scenario } from "../scenarios/types.js";
import { fakerFor, slugify } from "./util.js";

/**
 * Knowledge-base articles: per-scenario title bank, faker prose body.
 * The agent's plan builder expects logical-name keys (title, body, status,
 * language, external_ref) so the rows drop straight into article steps.
 */
export function generateArticles(scenario: Scenario, count: number, seed?: number): NormalizedRow[] {
  const f = fakerFor(seed);
  const rows: NormalizedRow[] = [];
  for (let i = 0; i < count; i++) {
    const title = scenario.articleTitles[i % scenario.articleTitles.length];
    // Faker prose, 3–5 paragraphs — looks like a real KB article body.
    const paragraphs = f.lorem.paragraphs({ min: 3, max: 5 }, "\n\n");
    rows.push({
      title,
      body: paragraphs,
      status: "published",
      language: "en",
      external_ref: `art-${slugify(title)}-${i + 1}`,
    });
  }
  return rows;
}
