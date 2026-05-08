import type { DevRevHttpClient } from "./client.js";

export type PartRecord = {
  id?: string;
  display_id?: string;
  type?: string;
  name?: string;
};

export async function partsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ part?: PartRecord }> {
  return client.post("parts.create", body);
}

export async function partsUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ part?: PartRecord }> {
  return client.post("parts.update", body);
}

export async function partsListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ parts?: PartRecord[]; next_cursor?: string; prev_cursor?: string }> {
  return client.post("parts.list", body);
}

export async function partsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ part?: PartRecord }> {
  return client.get("parts.get", { id });
}
