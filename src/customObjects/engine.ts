/**
 * Custom Objects Engine — DevRev API interactions and batch execution.
 *
 * Handles: schema creation, permission setup, parallel object creation,
 * annotations, unique key generation, and the full load orchestration.
 */

import { createHash } from "node:crypto";
import { parseDataFile } from "./parsers.js";
import { inferSchema, normalizeIdentifier, generateDisplayName, mapRowToCustomFields } from "./inference.js";
import type {
  ApiResponse,
  BatchResult,
  DevRevClient,
  FieldType,
  LoadConfig,
  LoadResult,
  SchemaField,
} from "./types.js";

// ─── Unique Key Generation ──────────────────────────────────────────────────

/**
 * Generate a unique key for deduplication.
 * Uses first 2 non-empty field values + a short hash of the full row.
 */
export function generateUniqueKey(
  row: Record<string, string>,
  leafType: string,
  rowIndex: number,
): string {
  const values = Object.values(row).filter((v) => v.trim() !== "");
  const keyParts = values.slice(0, 2).map((v) => v.replace(/\s+/g, "_").slice(0, 20));
  const hash = createHash("md5")
    .update(JSON.stringify(row) + rowIndex)
    .digest("hex")
    .slice(0, 8);
  return `${leafType}_${keyParts.join("_")}_${hash}`;
}

// ─── DevRev API Interactions ────────────────────────────────────────────────

/**
 * Create the tenant fragment schema for a custom object leaf type.
 */
export async function createTenantSchema(
  client: DevRevClient,
  leafTypeNormalized: string,
  fields: SchemaField[],
): Promise<ApiResponse> {
  const payload = {
    leaf_type: leafTypeNormalized,
    per_tenant_schema: {
      fields: fields.map((f) => ({
        name: f.name,
        field_type: f.field_type,
        ui: f.ui,
      })),
    },
  };

  // Try with UI metadata first, fallback without
  const resp = await client.post("schemas.custom.set", payload, { scope: "internal" });
  if (!resp.ok && resp.status === 400) {
    // Fallback: strip UI metadata
    const fallbackPayload = {
      leaf_type: leafTypeNormalized,
      per_tenant_schema: {
        fields: fields.map((f) => ({
          name: f.name,
          field_type: f.field_type,
        })),
      },
    };
    return client.post("schemas.custom.set", fallbackPayload, { scope: "internal" });
  }
  return resp;
}

/**
 * Create a custom type fragment schema for a subtype.
 */
export async function createSubtypeSchema(
  client: DevRevClient,
  leafTypeNormalized: string,
  subtypeNormalized: string,
): Promise<ApiResponse> {
  const payload = {
    leaf_type: leafTypeNormalized,
    custom_type_fragment: {
      subtype: subtypeNormalized,
      fields: [], // subtypes inherit tenant schema fields
    },
  };
  return client.post("schemas.custom.set", payload, { scope: "internal" });
}

/**
 * Update the admin role set with custom_object permissions.
 */
export async function updateRolePermissions(
  client: DevRevClient,
  roleSetId: string,
  leafTypeNormalized: string,
): Promise<ApiResponse> {
  const payload = {
    id: roleSetId,
    custom_object_roles: [
      {
        leaf_type: leafTypeNormalized,
        actions: ["read", "write", "delete"],
      },
    ],
  };
  return client.post("role-sets.update", payload, { scope: "internal" });
}

/**
 * Get the admin role set ID.
 */
export async function getAdminRoleSetId(client: DevRevClient): Promise<string | null> {
  const resp = await client.post("role-sets.list", {}, { scope: "internal" });
  if (!resp.ok) return null;

  const roleSets = (resp.data as any)?.role_sets ?? [];
  const admin = roleSets.find(
    (rs: any) => rs.identifier === "group-default3" || rs.name?.toLowerCase().includes("admin"),
  );
  return admin?.id ?? null;
}

/**
 * Create a single custom object.
 */
export async function createCustomObject(
  client: DevRevClient,
  opts: {
    customFields: Record<string, unknown>;
    uniqueKey: string;
    leafTypeNormalized: string;
    subtypeNormalized?: string;
    title?: string;
  },
): Promise<ApiResponse> {
  const payload: Record<string, unknown> = {
    unique_key: opts.uniqueKey,
    leaf_type: opts.leafTypeNormalized,
    custom_fields: opts.customFields,
    custom_schema_spec: {
      tenant_fragment: true,
      ...(opts.subtypeNormalized ? { subtype: opts.subtypeNormalized } : {}),
    },
  };

  if (opts.title) payload.title = opts.title;

  // Try internal endpoint first, then public
  const resp = await client.post("custom-objects.create", payload, { scope: "internal" });
  if (resp.status === 404) {
    return client.post("custom-objects.create", payload, { scope: "beta" });
  }
  return resp;
}

/**
 * Create a timeline annotation on a custom object.
 */
export async function annotateObject(
  client: DevRevClient,
  objectId: string,
  body: string,
): Promise<ApiResponse> {
  const payload = {
    object: objectId,
    type: "timeline_comment",
    body,
    visibility: "internal",
  };
  return client.post("timeline-entries.create", payload);
}

// ─── Parallel Batch Execution ───────────────────────────────────────────────

/**
 * Process rows in parallel batches.
 */
export async function processRowsInBatches(
  rows: Record<string, string>[],
  config: {
    client: DevRevClient;
    headerToField: Record<string, string>;
    fieldTypeByField: Record<string, FieldType>;
    leafType: string;
    leafTypeNormalized: string;
    subtypeNormalized?: string;
    idPrefix: string;
    annotate: boolean;
    annotationTemplate?: string;
    maxWorkers: number;
    batchSize: number;
    onProgress?: (result: BatchResult, done: number, total: number) => void;
  },
): Promise<LoadResult> {
  const {
    client,
    headerToField,
    fieldTypeByField,
    leafType,
    leafTypeNormalized,
    subtypeNormalized,
    idPrefix,
    annotate,
    annotationTemplate,
    maxWorkers,
    batchSize,
    onProgress,
  } = config;

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const objectIds: string[] = [];

  // Process in batches
  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    const batch = rows.slice(batchStart, batchStart + batchSize);

    // Process batch with concurrency limit
    const promises = batch.map(async (row, batchIndex): Promise<BatchResult> => {
      const rowIndex = batchStart + batchIndex;
      const customFields = mapRowToCustomFields(row, headerToField, fieldTypeByField);
      const uniqueKey = generateUniqueKey(row, leafTypeNormalized, rowIndex);

      // Generate title from first non-empty field
      const firstValue = Object.values(row).find((v) => v.trim() !== "") ?? `Row ${rowIndex + 1}`;
      const title = `${generateDisplayName(leafType)} - ${firstValue}`;

      try {
        const resp = await createCustomObject(client, {
          customFields,
          uniqueKey,
          leafTypeNormalized,
          subtypeNormalized,
          title,
        });

        if (resp.ok) {
          const objId = (resp.data as any)?.custom_object?.id ?? (resp.data as any)?.id;

          // Add annotation if enabled and we have an object ID
          if (annotate && objId) {
            const body =
              annotationTemplate ??
              `📦 Imported via \`dia load\` from row ${rowIndex + 1}.\n\n` +
                `**Leaf type:** ${leafType}\n` +
                `**Source:** ${config.leafType} data file`;
            try {
              await annotateObject(client, objId, body);
            } catch {
              // Non-blocking: annotation failure doesn't fail the row
            }
          }

          return { rowIndex, success: true, objectId: objId };
        } else if (resp.status === 409) {
          // Conflict — object already exists
          return { rowIndex, success: false, conflict: true };
        } else {
          const errBody = JSON.stringify(resp.data).slice(0, 200);
          return { rowIndex, success: false, error: `HTTP ${resp.status}: ${errBody}` };
        }
      } catch (e) {
        return { rowIndex, success: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    // Execute batch (batchSize controls concurrency since promises start immediately)
    const results = await Promise.all(promises);

    for (const result of results) {
      if (result.success) {
        created++;
        if (result.objectId) objectIds.push(result.objectId);
      } else if (result.conflict) {
        skipped++;
      } else {
        failed++;
      }
      onProgress?.(result, created + skipped + failed, rows.length);
    }
  }

  return {
    total: rows.length,
    created,
    skipped,
    failed,
    schemaCreated: true,
    leafType,
    objectIds,
  };
}

// ─── Main Orchestration ─────────────────────────────────────────────────────

/**
 * Full custom object load pipeline:
 * 1. Parse file
 * 2. Infer schema
 * 3. Create DevRev schema
 * 4. Set permissions
 * 5. Create objects in parallel
 * 6. Optionally annotate
 */
export async function executeLoad(
  config: LoadConfig,
  client: DevRevClient,
  onProgress?: (result: BatchResult, done: number, total: number) => void,
): Promise<LoadResult> {
  // 1. Parse file
  const { headers, rows } = await parseDataFile(config.dataPath);
  if (rows.length === 0) {
    return { total: 0, created: 0, skipped: 0, failed: 0, schemaCreated: false, leafType: config.leafType, objectIds: [] };
  }

  // 2. Infer schema
  const schema = inferSchema(headers, rows, config.fieldTypeOverrides);

  const leafTypeNormalized = normalizeIdentifier(config.leafType);
  const subtypesNormalized = config.subtypes.map(normalizeIdentifier);

  // 3. Create tenant schema
  const schemaResp = await createTenantSchema(client, leafTypeNormalized, schema.fields);
  if (!schemaResp.ok) {
    throw new Error(`Schema creation failed (HTTP ${schemaResp.status}): ${JSON.stringify(schemaResp.data).slice(0, 300)}`);
  }

  // 4. Create subtype schemas
  for (const st of subtypesNormalized) {
    const stResp = await createSubtypeSchema(client, leafTypeNormalized, st);
    if (!stResp.ok) {
      throw new Error(`Subtype schema '${st}' failed (HTTP ${stResp.status}): ${JSON.stringify(stResp.data).slice(0, 300)}`);
    }
  }

  // 5. Set permissions (best-effort)
  try {
    const roleSetId = await getAdminRoleSetId(client);
    if (roleSetId) {
      await updateRolePermissions(client, roleSetId, leafTypeNormalized);
    }
  } catch {
    // Non-blocking: permission setup failure doesn't stop the load
  }

  // 6. Create objects in parallel batches
  return processRowsInBatches(rows, {
    client,
    headerToField: schema.headerToField,
    fieldTypeByField: schema.fieldTypeByField,
    leafType: config.leafType,
    leafTypeNormalized,
    subtypeNormalized: subtypesNormalized[0],
    idPrefix: config.idPrefix,
    annotate: config.annotate,
    annotationTemplate: config.annotationTemplate,
    maxWorkers: config.maxWorkers,
    batchSize: config.batchSize,
    onProgress,
  });
}
