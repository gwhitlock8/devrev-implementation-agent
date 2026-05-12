/**
 * File parsers for the Custom Objects engine.
 * Supports: CSV, TSV, JSON, JSONL, XLSX/XLS.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { extname } from "node:path";
import type { FileFormat } from "./types.js";

// ─── File Format Detection ──────────────────────────────────────────────────

const FORMAT_MAP: Record<string, FileFormat> = {
  ".csv": "csv",
  ".tsv": "tsv",
  ".json": "json",
  ".jsonl": "jsonl",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
};

export function detectFileFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  const format = FORMAT_MAP[ext];
  if (!format) {
    const supported = Object.keys(FORMAT_MAP).join(", ");
    throw new Error(`Unsupported file format: ${ext}. Supported: ${supported}`);
  }
  return format;
}

// ─── Delimited (CSV/TSV) Parser ─────────────────────────────────────────────

/** Simple CSV/TSV line parser (handles quoted fields). */
function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a delimited file (CSV or TSV) and return headers + rows.
 */
export async function parseDelimitedFile(
  filePath: string,
  delimiter: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("File is empty");

  const headers = parseLine(lines[0], delimiter);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ─── JSON Parser ────────────────────────────────────────────────────────────

/**
 * Parse a JSON file (expects array of objects).
 */
export async function parseJsonFile(
  filePath: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const content = await readFile(filePath, "utf8");
  const data = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error("JSON file must contain an array of objects");
  if (data.length === 0) return { headers: [], rows: [] };

  // Collect all unique keys across all objects
  const keySet = new Set<string>();
  for (const obj of data) {
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj)) keySet.add(key);
    }
  }
  const headers = [...keySet];

  // Flatten to string values
  const rows = data.map((obj: Record<string, unknown>) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      const val = obj[h];
      row[h] = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
    }
    return row;
  });

  return { headers, rows };
}

// ─── JSONL Parser ───────────────────────────────────────────────────────────

/**
 * Parse a JSONL file (one JSON object per line).
 */
export async function parseJsonlFile(
  filePath: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  const keySet = new Set<string>();
  const rawRows: Record<string, unknown>[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj)) keySet.add(key);
      rawRows.push(obj);
    }
  }

  const headers = [...keySet];
  const rows = rawRows.map((obj) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      const val = obj[h];
      row[h] = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
    }
    return row;
  });

  return { headers, rows };
}

// ─── XLSX/XLS Parser ────────────────────────────────────────────────────────

/**
 * Parse an XLSX/XLS file using the `xlsx` npm package.
 * Reads the first sheet and converts to headers + rows.
 */
export async function parseXlsxFile(
  filePath: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error(
      "XLSX support requires the 'xlsx' package. Install it with: npm install xlsx",
    );
  }

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("XLSX file has no sheets");

  const sheet = workbook.Sheets[sheetName];
  const rawData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rawData.length === 0) return { headers: [], rows: [] };

  // Extract headers from first row keys
  const headers = Object.keys(rawData[0]);

  // Convert all values to strings
  const rows = rawData.map((obj) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      const val = obj[h];
      row[h] = val == null ? "" : String(val);
    }
    return row;
  });

  return { headers, rows };
}

// ─── Unified Parser ─────────────────────────────────────────────────────────

/**
 * Unified file parser - detects format and routes to the correct parser.
 */
export async function parseDataFile(
  filePath: string,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const format = detectFileFormat(filePath);
  switch (format) {
    case "csv":
      return parseDelimitedFile(filePath, ",");
    case "tsv":
      return parseDelimitedFile(filePath, "\t");
    case "json":
      return parseJsonFile(filePath);
    case "jsonl":
      return parseJsonlFile(filePath);
    case "xlsx":
      return parseXlsxFile(filePath);
  }
}
