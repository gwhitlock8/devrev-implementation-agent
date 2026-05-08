import type { DevRevHttpClient } from "./client.js";

export type AccountRecord = {
  id?: string;
  display_id?: string;
  display_name?: string;
};

export async function accountsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ account?: AccountRecord }> {
  return client.post("accounts.create", body);
}

export async function accountsUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ account?: AccountRecord }> {
  return client.post("accounts.update", body);
}

export async function accountsListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ accounts?: AccountRecord[]; next_cursor?: string }> {
  return client.post("accounts.list", body);
}

export async function accountsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ account?: AccountRecord }> {
  return client.get("accounts.get", { id });
}
