import type { DevRevHttpClient } from "./client.js";

export type TagRecord = {
  id?: string;
  display_id?: string;
  name?: string;
};

export async function tagsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ tag?: TagRecord }> {
  return client.post("tags.create", body);
}

export async function tagsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ tag?: TagRecord }> {
  return client.get("tags.get", { id });
}

export async function tagsListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ tags?: TagRecord[]; next_cursor?: string }> {
  return client.post("tags.list", body);
}
