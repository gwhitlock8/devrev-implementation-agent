import type { DevRevHttpClient } from "./client.js";

export type RevUserRecord = {
  id?: string;
  display_id?: string;
  email?: string;
  display_name?: string;
  external_ref?: string;
};

export async function revUsersCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ rev_user?: RevUserRecord }> {
  return client.post("rev-users.create", body);
}

export async function revUsersUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ rev_user?: RevUserRecord }> {
  return client.post("rev-users.update", body);
}

export async function revUsersList(
  client: DevRevHttpClient,
  query?: Record<string, string | number | boolean | string[] | undefined>,
): Promise<{ rev_users?: RevUserRecord[]; next_cursor?: string }> {
  return client.get("rev-users.list", query);
}

export async function revUsersGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ rev_user?: RevUserRecord }> {
  return client.get("rev-users.get", { id });
}
