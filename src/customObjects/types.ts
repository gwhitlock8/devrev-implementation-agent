/**
 * Type definitions for the Custom Objects engine.
 */

// ─── Field & Schema Types ──────────────────────────────────────────────────────

export type FieldType = "text" | "int" | "double" | "bool" | "timestamp";

export interface SchemaField {
  name: string;
  field_type: FieldType;
  ui: { display_name: string };
}

export interface InferredSchema {
  fields: SchemaField[];
  headerToField: Record<string, string>;
  fieldTypeByField: Record<string, FieldType>;
}

// ─── Config & Result ───────────────────────────────────────────────────────────

export interface LoadConfig {
  dataPath: string;
  leafType: string;
  idPrefix: string;
  subtypes: string[];
  fieldTypeOverrides: Record<string, FieldType>;
  annotate: boolean;
  annotationTemplate?: string;
  maxWorkers: number;
  batchSize: number;
  verbose: boolean;
}

export interface LoadResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  schemaCreated: boolean;
  leafType: string;
  objectIds: string[];
}

export interface BatchResult {
  rowIndex: number;
  success: boolean;
  objectId?: string;
  conflict?: boolean;
  error?: string;
}

// ─── File Format ───────────────────────────────────────────────────────────────

export type FileFormat = "csv" | "tsv" | "json" | "jsonl" | "xlsx";

// ─── DevRev Client Interface ───────────────────────────────────────────────────

export interface DevRevClient {
  post(endpoint: string, payload: unknown, options?: { scope?: string }): Promise<ApiResponse>;
}

export interface ApiResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}
