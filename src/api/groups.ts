import type { DevRevHttpClient } from "./client.js";

export type GroupRecord = {
  id?: string;
  display_id?: string;
  name?: string;
  description?: string;
};

/**
 * Create a group (e.g. support team, escalation group). Groups are used
 * for routing, assignment rules, and SLA-scoped ownership in DevRev.
 */
export async function groupsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ group?: GroupRecord }> {
  return client.post("groups.create", body);
}

export async function groupsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ group?: GroupRecord }> {
  return client.get("groups.get", { id });
}

export async function groupsListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ groups?: GroupRecord[]; next_cursor?: string }> {
  return client.post("groups.list", body);
}
