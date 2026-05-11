import type { DevRevHttpClient } from "./client.js";

export type CustomStageRecord = {
  id?: string;
  display_id?: string;
  name?: string;
  ordinal?: number;
  state?: string;
};

export type CustomStateRecord = {
  id?: string;
  name?: string;
  is_final?: boolean;
};

/**
 * Create a custom stage. Requires `name`, `ordinal`, and `state` (a DON ID
 * referencing a custom_state object — NOT a string enum).
 *
 * DevRev creates three default states per org: open, in_progress, closed.
 * Use `discoverStateIds()` to map friendly names to DON IDs before calling
 * this endpoint.
 *
 * Promoted to public API in DevRev changelog June 2025 as
 * `stages.custom.create`.
 */
export async function customStagesCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ custom_stage?: CustomStageRecord }> {
  return client.post("stages.custom.create", body);
}

export async function customStagesGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ custom_stage?: CustomStageRecord }> {
  return client.get("stages.custom.get", { id });
}

export async function customStagesListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ result?: CustomStageRecord[]; cursor?: string }> {
  return client.post("stages.custom.list", body);
}

/**
 * Discover the org's custom_state DON IDs by listing existing stages and
 * extracting the unique state references. DevRev doesn't expose a
 * `custom-states.list` endpoint, so we infer state IDs from the stages
 * that already exist in every org (triage, backlog, etc. always exist).
 *
 * Returns a map: { "open": "don:core:…:custom_state/1", … }
 */
export async function discoverStateIds(
  client: DevRevHttpClient,
): Promise<Map<string, string>> {
  const stateMap = new Map<string, string>();
  // List existing stages (every org has built-in ones).
  // Response uses `result` array, not `custom_stages`.
  const res = await customStagesListPost(client, {});
  for (const stage of res.result ?? []) {
    // The stage object includes a nested `state` with `id` and `name`.
    const stageAny = stage as Record<string, unknown>;
    const stateObj = stageAny.state as { id?: string; name?: string } | undefined;
    if (stateObj?.id && stateObj?.name && !stateMap.has(stateObj.name)) {
      stateMap.set(stateObj.name, stateObj.id);
    }
  }
  return stateMap;
}
