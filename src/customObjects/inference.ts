/**
 * Type inference and schema building for Custom Objects.
 *
 * Handles: field name normalization, type detection from samples,
 * schema construction, timestamp conversion, and row → custom_fields mapping.
 */

import type { FieldType, InferredSchema, SchemaField } from "./types.js";

// ─── Field Name Normalization ───────────────────────────────────────────────

/**
 * Normalize a header string into a DevRev-compliant snake_case field name.
 * - Strips non-alphanumeric characters (except spaces/underscores)
 * - Converts to lowercase snake_case
 * - Truncates to 64 chars
 */
export function normalizeFieldName(header: string): string {
  return header
    .trim()
    .replace(/[^a-zA-Z0-9\s_]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

/**
 * Normalize a leaf type or subtype identifier.
 * Same rules as field names but max 10 chars.
 */
export function normalizeIdentifier(value: string): string {
  return normalizeFieldName(value).slice(0, 10);
}

/**
 * Generate a human-friendly display name from a header.
 */
export function generateDisplayName(header: string): string {
  return header
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ─── Type Inference Engine ──────────────────────────────────────────────────

const BOOLEAN_TRUE = new Set(["true", "1", "yes", "y", "on", "enabled", "active"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no", "n", "off", "disabled", "inactive"]);
export const ALL_BOOLEANS = new Set([...BOOLEAN_TRUE, ...BOOLEAN_FALSE]);

/** Common date formats for timestamp detection. */
const DATE_PATTERNS: RegExp[] = [
  // ISO 8601
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  // US date: MM/DD/YYYY or MM-DD-YYYY
  /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/,
  // Epoch seconds (10 digits) or milliseconds (13 digits)
  /^\d{10}(\d{3})?$/,
  // Text dates: "August 15, 2025", "15 Aug 2025"
  /^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/,
  /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/,
];

function looksLikeTimestamp(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return DATE_PATTERNS.some((p) => p.test(v));
}

function looksLikeInt(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^-?\d+$/.test(v);
}

function looksLikeDouble(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^-?\d+\.\d+$/.test(v);
}

function looksLikeBool(value: string): boolean {
  return ALL_BOOLEANS.has(value.trim().toLowerCase());
}

/**
 * Infer field type from a sample of values.
 * Uses threshold-based detection: ≥80% of non-empty samples must match.
 */
export function inferFieldType(samples: string[]): FieldType {
  const nonEmpty = samples.filter((s) => s.trim() !== "");
  if (nonEmpty.length === 0) return "text";

  const threshold = 0.8;
  const count = nonEmpty.length;

  // Check bool first (most restrictive set)
  const boolCount = nonEmpty.filter(looksLikeBool).length;
  if (boolCount / count >= threshold) return "bool";

  // Check int
  const intCount = nonEmpty.filter(looksLikeInt).length;
  if (intCount / count >= threshold) return "int";

  // Check double (includes int-like values)
  const doubleCount = nonEmpty.filter((v) => looksLikeDouble(v) || looksLikeInt(v)).length;
  const pureDoubleCount = nonEmpty.filter(looksLikeDouble).length;
  if (pureDoubleCount > 0 && doubleCount / count >= threshold) return "double";

  // Check timestamp
  const tsCount = nonEmpty.filter(looksLikeTimestamp).length;
  if (tsCount / count >= threshold) return "timestamp";

  return "text";
}

/**
 * Smart ID field detection: if field name contains "id", keep as text
 * if there are leading zeros or non-numeric content.
 */
function shouldForceTextForIdField(fieldName: string, samples: string[]): boolean {
  if (!fieldName.includes("id")) return false;
  const nonEmpty = samples.filter((s) => s.trim() !== "");
  const hasLeadingZeros = nonEmpty.some(
    (s) => s.startsWith("0") && s.length > 1 && /^\d+$/.test(s),
  );
  const hasNonNumeric = nonEmpty.some((s) => !/^\d+$/.test(s) && s !== "0");
  return hasLeadingZeros || hasNonNumeric;
}

// ─── Schema Inference ───────────────────────────────────────────────────────

/**
 * Infer a full DevRev custom object schema from parsed data.
 * Samples up to `sampleLimit` rows for type inference.
 */
export function inferSchema(
  headers: string[],
  rows: Record<string, string>[],
  fieldTypeOverrides: Record<string, FieldType> = {},
  sampleLimit = 200,
): InferredSchema {
  const sampleRows = rows.slice(0, sampleLimit);

  // Build header → normalized field name mapping
  const headerToField: Record<string, string> = {};
  for (const h of headers) {
    headerToField[h] = normalizeFieldName(h);
  }

  // Collect samples per field
  const samples: Record<string, string[]> = {};
  for (const h of headers) {
    const fname = headerToField[h];
    samples[fname] = sampleRows.map((row) => row[h] ?? "");
  }

  // Infer types
  const fieldTypeByField: Record<string, FieldType> = {};
  for (const h of headers) {
    const fname = headerToField[h];
    fieldTypeByField[fname] = inferFieldType(samples[fname]);
  }

  // Smart ID field detection
  for (const h of headers) {
    const fname = headerToField[h];
    if (shouldForceTextForIdField(fname, samples[fname])) {
      fieldTypeByField[fname] = "text";
    }
  }

  // Apply explicit overrides (highest priority)
  for (const [fname, ftype] of Object.entries(fieldTypeOverrides)) {
    const normalizedKey = normalizeFieldName(fname);
    if (normalizedKey in fieldTypeByField) {
      fieldTypeByField[normalizedKey] = ftype;
    }
  }

  // Build schema fields
  const fields: SchemaField[] = headers.map((h) => {
    const fname = headerToField[h];
    return {
      name: fname,
      field_type: fieldTypeByField[fname],
      ui: { display_name: generateDisplayName(h) },
    };
  });

  return { fields, headerToField, fieldTypeByField };
}

// ─── Timestamp Conversion ───────────────────────────────────────────────────

/**
 * Convert various date/time string formats to ISO 8601.
 * Returns null if conversion fails.
 */
export function convertToIsoTimestamp(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  // Already ISO 8601
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    if (v.length === 10) return `${v}T00:00:00Z`;
    if (!v.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(v)) return `${v}Z`;
    return v;
  }

  // Epoch seconds (10 digits) or milliseconds (13 digits)
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  if (/^\d{13}$/.test(v)) return new Date(Number(v)).toISOString();

  // US/EU dates: MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    // Assume US format (MM/DD/YYYY) if first number ≤ 12
    const month = Number(a) <= 12 ? a : b;
    const day = Number(a) <= 12 ? b : a;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`;
  }

  // Try native Date parse as fallback
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

// ─── Row → Custom Fields Mapping ────────────────────────────────────────────

/**
 * Map a data row to DevRev custom_fields with tnt__ prefix.
 */
export function mapRowToCustomFields(
  row: Record<string, string>,
  headerToField: Record<string, string>,
  fieldTypeByField: Record<string, FieldType>,
): Record<string, unknown> {
  const customFields: Record<string, unknown> = {};

  for (const [header, value] of Object.entries(row)) {
    const fieldName = headerToField[header];
    if (!fieldName) continue;

    const raw = (value ?? "").trim();
    if (raw === "") continue;

    const ftype = fieldTypeByField[fieldName] ?? "text";
    const key = `tnt__${fieldName}`;

    switch (ftype) {
      case "int": {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed)) customFields[key] = parsed;
        break;
      }
      case "double": {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) customFields[key] = parsed;
        break;
      }
      case "bool": {
        const lower = raw.toLowerCase();
        if (BOOLEAN_TRUE.has(lower)) customFields[key] = true;
        else if (BOOLEAN_FALSE.has(lower)) customFields[key] = false;
        break;
      }
      case "timestamp": {
        const ts = convertToIsoTimestamp(raw);
        if (ts) customFields[key] = ts;
        break;
      }
      default:
        customFields[key] = raw;
    }
  }

  return customFields;
}
