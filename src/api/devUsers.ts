import type { DevRevHttpClient } from "./client.js";

export type DevUserRecord = {
  id: string;
  display_id: string;
  full_name?: string;
  display_handle?: string;
  email?: string;
  /** Active / inactive / shadow / etc. Always returned by both endpoints. */
  state?: string;
  /** DevRev surfaces a few different role/permission shapes depending on
   * tenant config; we accept any string-ish value and surface what's there. */
  role?: string;
  permission_set?: string | { id?: string; name?: string };
  user_type?: string;
};

export type DevUserSelfResponse = {
  dev_user?: DevUserRecord;
};

export async function devUsersSelf(client: DevRevHttpClient): Promise<DevUserSelfResponse> {
  return client.get<DevUserSelfResponse>("dev-users.self");
}

export async function devUsersGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ dev_user?: DevUserRecord }> {
  return client.get<{ dev_user?: DevUserRecord }>("dev-users.get", { id });
}
