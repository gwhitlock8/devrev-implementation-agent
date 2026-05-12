/**
 * Custom Objects module — public API.
 *
 * Re-exports everything consumers need from the sub-modules.
 */

// Types
export type {
  FieldType,
  SchemaField,
  InferredSchema,
  LoadConfig,
  LoadResult,
  BatchResult,
  FileFormat,
  DevRevClient,
  ApiResponse,
} from "./types.js";

// Parsers
export {
  detectFileFormat,
  parseDataFile,
  parseDelimitedFile,
  parseJsonFile,
  parseJsonlFile,
  parseXlsxFile,
} from "./parsers.js";

// Inference
export {
  normalizeFieldName,
  normalizeIdentifier,
  generateDisplayName,
  inferFieldType,
  inferSchema,
  convertToIsoTimestamp,
  mapRowToCustomFields,
} from "./inference.js";

// Engine
export {
  generateUniqueKey,
  createTenantSchema,
  createSubtypeSchema,
  updateRolePermissions,
  getAdminRoleSetId,
  createCustomObject,
  annotateObject,
  processRowsInBatches,
  executeLoad,
} from "./engine.js";
