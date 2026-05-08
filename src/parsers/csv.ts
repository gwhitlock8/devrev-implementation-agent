import { readFile } from "node:fs/promises";
import Papa from "papaparse";

export type CsvEntity = "contacts" | "accounts" | "tickets" | "issues" | "articles";

export type NormalizedRow = Record<string, string>;

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Maps common CSV headers to logical fields used when building plan steps */
export const HEADER_ALIASES: Record<string, string> = {
  // Generic
  name: "display_name",
  full_name: "display_name",
  contact_name: "display_name",
  company: "account_name",
  account: "account_name",
  account_name: "account_name",
  account_id: "account",
  rev_org: "rev_org",
  workspace: "rev_org",
  email: "email",
  phone: "phone",
  title: "title",
  subject: "title",
  description: "body",
  description_text: "body",
  details: "body",
  product: "applies_to_part",
  part: "applies_to_part",
  priority: "priority",
  external_id: "external_ref",
  external_ref: "external_ref",
  // Articles
  article_title: "title",
  article_body: "body",
  status: "status",
  language: "language",
  locale: "language",
  // Freshdesk-style
  ticket_id: "external_ref",
  priority_name: "priority",
  status_name: "stage",
  group_name: "group",
  agent_name: "owned_by",
  requester_name: "reported_by",
  created_at: "created_date",
  // Zendesk-style
  id: "external_ref",
  group: "group",
  assignee: "owned_by",
  requester: "reported_by",
};

/**
 * Heuristic detection of common source-system CSV exports. We look at the raw
 * (untransformed) headers and check for signature combinations that strongly
 * indicate the source. Keep this conservative — false positives silently
 * apply column maps the SE didn't ask for.
 */
export type SourceSystem = "freshdesk" | "zendesk" | "unknown";

export function detectSourceSystem(headers: string[]): SourceSystem {
  const norm = headers.map((h) => h.toLowerCase().trim());
  const set = new Set(norm);
  // Freshdesk exports use "Ticket ID" + "Requester Name" + "Agent Name".
  if (set.has("ticket id") && set.has("requester name") && set.has("agent name")) {
    return "freshdesk";
  }
  // Zendesk exports use lowercase "id" + "requester" + "assignee".
  if (set.has("id") && set.has("requester") && set.has("assignee")) {
    return "zendesk";
  }
  return "unknown";
}

export function mapRowHeaders(
  row: NormalizedRow,
  columnMap?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const nk = normalizeHeader(k);
    const logical = columnMap?.[k] ?? columnMap?.[nk] ?? HEADER_ALIASES[nk] ?? nk;
    if (v !== undefined && v !== "") out[logical] = v.trim();
  }
  return out;
}

export type ParsedCsv = {
  rows: NormalizedRow[];
  source: SourceSystem;
  /** Original (pre-normalization) headers, in column order. */
  headers: string[];
};

export async function parseCsvFile(path: string): Promise<NormalizedRow[]> {
  return (await parseCsvFileWithMeta(path)).rows;
}

export async function parseCsvFileWithMeta(path: string): Promise<ParsedCsv> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => `${e.row}: ${e.message}`).join("; ");
    throw new Error(`CSV parse errors: ${msg}`);
  }
  const headers = parsed.meta.fields ?? [];
  const rows: NormalizedRow[] = [];
  for (const r of parsed.data) {
    const obj: NormalizedRow = {};
    for (const [k, val] of Object.entries(r)) {
      obj[k] = val === null || val === undefined ? "" : String(val);
    }
    rows.push(obj);
  }
  return { rows, source: detectSourceSystem(headers), headers };
}
