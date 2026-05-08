import type { DevRevHttpClient } from "./client.js";

export type RevOrgRecord = {
  id?: string;
  display_id?: string;
  display_name?: string;
};

/** List rev orgs (workspaces); filter by account when bootstrapping contacts. */
export async function revOrgsListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ rev_orgs?: RevOrgRecord[]; next_cursor?: string }> {
  return client.post("rev-orgs.list", body);
}

export async function revOrgsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ rev_org?: RevOrgRecord }> {
  return client.post("rev-orgs.create", body);
}

export async function revOrgsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ rev_org?: RevOrgRecord }> {
  return client.get("rev-orgs.get", { id });
}
