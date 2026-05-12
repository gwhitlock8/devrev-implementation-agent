/**
 * Custom object row generation for `dia generate --entity custom:<leaf-type>`.
 *
 * Produces faker-based rows with a generic schema suitable for any custom
 * leaf type (title, description, status, priority, plus a handful of
 * illustrative custom fields). The output can be piped into `dia load`.
 */

import { Faker, en, faker as defaultFaker } from "@faker-js/faker";
import Papa from "papaparse";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GenerateCustomOpts {
  leafType: string;
  count: number;
  seed?: number;
  scenario: string;
}

export type CustomRow = Record<string, string>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fakerFor(seed: number | undefined): Faker {
  if (seed === undefined) return defaultFaker;
  const f = new Faker({ locale: [en] });
  f.seed(seed);
  return f;
}

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["p0", "p1", "p2", "p3"];

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate synthetic rows for a custom object leaf type.
 * Each row contains generic fields that map well to most custom objects.
 */
export function generateCustomRows(opts: GenerateCustomOpts): CustomRow[] {
  const { leafType, count, seed } = opts;
  const f = fakerFor(seed);
  const rows: CustomRow[] = [];

  for (let i = 0; i < count; i++) {
    rows.push({
      title: `${capitalize(leafType)} - ${f.lorem.words({ min: 3, max: 6 })}`,
      description: f.lorem.sentence({ min: 8, max: 20 }),
      status: STATUSES[f.number.int({ min: 0, max: STATUSES.length - 1 })],
      priority: PRIORITIES[f.number.int({ min: 0, max: PRIORITIES.length - 1 })],
      external_ref: `${leafType}-${f.string.alphanumeric(8)}`,
      created_date: f.date
        .recent({ days: 90 })
        .toISOString()
        .split("T")[0],
      owner_email: f.internet.email(),
      category: f.commerce.department(),
      notes: f.lorem.sentence({ min: 4, max: 12 }),
    });
  }

  return rows;
}

/**
 * Serialize custom rows into a CSV string (with header).
 */
export function customRowsToCsv(rows: CustomRow[]): string {
  if (rows.length === 0) return "";
  return Papa.unparse(rows, { newline: "\n" }) + "\n";
}

// ─── Internal ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
