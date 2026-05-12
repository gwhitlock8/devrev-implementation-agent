/**
 * `dia load` — Import custom objects from a data file into DevRev.
 *
 * Reads CSV/TSV/JSON/JSONL/XLSX, infers schema, creates the custom object type,
 * and bulk-loads records with optional timeline annotations.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DevRevHttpClient, DevRevHttpError } from "../api/client.js";
import { resolveOrgIdentity, formatOrgBanner } from "../api/devUsers.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";
import {
  detectFileFormat,
  executeLoad,
  inferSchema,
  normalizeIdentifier,
  parseDataFile,
  type BatchResult,
  type DevRevClient,
  type LoadConfig,
  type ApiResponse,
} from "../customObjects/index.js";

// ─── CLI Args ───────────────────────────────────────────────────────────────

export type LoadCliArgs = {
  dataPath: string;
  leafType: string;
  idPrefix?: string;
  subtypes?: string;
  fieldTypeOverrides?: string;
  annotate: boolean;
  annotationTemplate?: string;
  maxWorkers: number;
  batchSize: number;
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
};

// ─── Adapter: wrap DevRevHttpClient to match DevRevClient interface ─────────

/**
 * Wraps DevRevHttpClient (which throws on non-2xx) into a non-throwing
 * DevRevClient interface that returns { ok, status, data } for every call.
 */
function createClientAdapter(httpClient: DevRevHttpClient): DevRevClient {
  return {
    async post(endpoint: string, payload: unknown, options?: { scope?: string }): Promise<ApiResponse> {
      const scope = options?.scope;
      // Route to internal or regular API based on scope
      const operation = scope === "internal" ? `internal/${endpoint}` : endpoint;

      try {
        const data = await httpClient.post<Record<string, unknown>>(operation, payload);
        return { ok: true, status: 200, data };
      } catch (e: unknown) {
        if (e instanceof DevRevHttpError) {
          // Parse the body text as JSON if possible
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(e.bodyText);
          } catch {
            data = { error: e.bodyText || e.message };
          }
          return { ok: false, status: e.status, data };
        }
        // Network or unexpected errors
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 0, data: { error: msg } };
      }
    },
  };
}

// ─── Command Handler ────────────────────────────────────────────────────────

export async function loadCommand(args: LoadCliArgs): Promise<void> {
  loadEnvFiles();

  const pat = requireEnv("DEVREV_PAT");
  const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
  const isJson = Boolean(args.json);

  // Resolve and validate data path
  const dataPath = resolve(args.dataPath);
  try {
    await stat(dataPath);
  } catch {
    throw new Error(`File not found: ${dataPath}`);
  }

  // Detect format early for user feedback
  const format = detectFileFormat(dataPath);

  // Parse field type overrides
  let fieldTypeOverrides: Record<string, any> = {};
  if (args.fieldTypeOverrides) {
    try {
      fieldTypeOverrides = JSON.parse(args.fieldTypeOverrides);
    } catch (e) {
      throw new Error(`Invalid --field-type-overrides JSON: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Parse subtypes
  const subtypes: string[] = [];
  if (args.subtypes) {
    try {
      const parsed = JSON.parse(args.subtypes);
      if (Array.isArray(parsed)) subtypes.push(...parsed.map(String));
      else subtypes.push(...args.subtypes.split(",").map((s) => s.trim()).filter(Boolean));
    } catch {
      subtypes.push(...args.subtypes.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }

  const config: LoadConfig = {
    dataPath,
    leafType: args.leafType,
    idPrefix: args.idPrefix ?? args.leafType.slice(0, 3).toUpperCase(),
    subtypes,
    fieldTypeOverrides,
    annotate: args.annotate,
    annotationTemplate: args.annotationTemplate,
    maxWorkers: args.maxWorkers,
    batchSize: args.batchSize,
    verbose: args.verbose,
  };

  const leafTypeNormalized = normalizeIdentifier(config.leafType);

  // Create DevRev client
  const httpClient = new DevRevHttpClient({ pat, betaScope: beta });
  const client = createClientAdapter(httpClient);

  // Print org identity
  if (!isJson) {
    const orgId = await resolveOrgIdentity(httpClient);
    console.log(`\n  Org: ${formatOrgBanner(orgId)}`);
    console.log();
    console.log(`  📦 Loading custom objects from ${format.toUpperCase()} file`);
    console.log(`  📋 Leaf type: ${config.leafType} (normalized: ${leafTypeNormalized})`);
    console.log(`  🏷️  ID prefix: ${config.idPrefix}`);
    if (subtypes.length > 0) {
      console.log(`  🔀 Subtypes: ${subtypes.join(", ")}`);
    }
    if (args.annotate) {
      console.log(`  📝 Annotations: enabled`);
    }
    console.log(`  ⚡ Parallel: ${config.maxWorkers} workers, batch size ${config.batchSize}`);
    if (args.dryRun) {
      console.log(`  🔍 DRY RUN — no objects will be created`);
    }
    console.log();
  }

  // Dry run: parse and show schema only
  if (args.dryRun) {
    const { headers, rows } = await parseDataFile(dataPath);

    const schema = inferSchema(headers, rows, fieldTypeOverrides);

    if (isJson) {
      console.log(JSON.stringify({ dryRun: true, recordCount: rows.length, schema: schema.fields }, null, 2));
    } else {
      console.log(`  Found ${rows.length} record(s). Inferred schema:\n`);
      const maxNameLen = Math.max(...schema.fields.map((f) => f.name.length));
      for (const field of schema.fields) {
        const pad = " ".repeat(maxNameLen - field.name.length);
        console.log(`    ${field.name}${pad}  ${field.field_type.padEnd(9)}  "${field.ui.display_name}"`);
      }
      console.log(`\n  Run without --dry-run to create the schema and load ${rows.length} objects.`);
    }
    return;
  }

  // Execute the full load pipeline
  const startTime = Date.now();

  const onProgress: (result: BatchResult, done: number, total: number) => void = isJson
    ? () => {}
    : (result, done, total) => {
        if (result.success) {
          console.log(`  ✓ [${done}/${total}] Created ${config.leafType} object${result.objectId ? ` → ${result.objectId}` : ""}`);
        } else if (result.conflict) {
          console.log(`  ~ [${done}/${total}] Skipped row ${result.rowIndex + 1} (already exists)`);
        } else {
          console.log(`  ✗ [${done}/${total}] Failed row ${result.rowIndex + 1}: ${result.error?.slice(0, 100)}`);
        }
      };

  const loadResult = await executeLoad(config, client, onProgress);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (isJson) {
    console.log(JSON.stringify({ ...loadResult, elapsedSeconds: Number(elapsed) }));
  } else {
    console.log();
    console.log(`  Done: ${loadResult.created} created, ${loadResult.skipped} skipped, ${loadResult.failed} failed. (${elapsed}s)`);
    console.log();
    console.log(`  Summary:`);
    console.log(`    • Schema: ${loadResult.schemaCreated ? "✓ created" : "✗ failed"} (leaf type: ${leafTypeNormalized})`);
    console.log(`    • Records processed: ${loadResult.total}`);
    console.log(`    • Objects created: ${loadResult.created}`);
    if (loadResult.skipped > 0) console.log(`    • Conflicts (skipped): ${loadResult.skipped}`);
    if (loadResult.failed > 0) console.log(`    • Failed: ${loadResult.failed}`);
    if (args.annotate) console.log(`    • Annotations: added to created objects`);
    console.log();
  }
}
