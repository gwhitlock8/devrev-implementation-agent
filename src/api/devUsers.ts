import type { DevRevHttpClient } from "./client.js";

/** Minimal client shape accepted by identity helpers — works with both
 *  DevRevHttpClient and ReadOnlyDevRevClient. */
export type DevRevGetClient = {
  get<T = unknown>(
    operation: string,
    query?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T>;
};

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

// ---------------------------------------------------------------------------
// Org identity
// ---------------------------------------------------------------------------

export type DevOrgRecord = {
  id: string;
  display_id: string;
  display_name?: string;
  dev_slug?: string;
};

export type DevOrgGetResponse = {
  dev_org?: DevOrgRecord;
};

/**
 * Returns the org that the PAT is scoped to. No parameters required — the
 * server infers the org from the token.
 */
export async function devOrgsGet(client: DevRevGetClient): Promise<DevOrgGetResponse> {
  return client.get<DevOrgGetResponse>("dev-orgs.get");
}

/**
 * Returns the authenticated dev user. Accepts any client with a `.get()`.
 */
export async function devUsersSelfGeneric(client: DevRevGetClient): Promise<DevUserSelfResponse> {
  return client.get<DevUserSelfResponse>("dev-users.self");
}

// ---------------------------------------------------------------------------
// Combined identity helper
// ---------------------------------------------------------------------------

export type OrgIdentity = {
  orgName: string;
  orgSlug: string;
  orgDisplayId: string;
  userName: string;
  userEmail: string;
};

/**
 * Resolves both the org and the authenticated user in parallel.
 * Returns a friendly label set for display. Never throws — fields
 * fall back to "unknown" on failure.
 *
 * Accepts DevRevHttpClient or ReadOnlyDevRevClient (duck-typed).
 */
export async function resolveOrgIdentity(
  client: DevRevGetClient,
): Promise<OrgIdentity> {
  const [orgRes, selfRes] = await Promise.all([
    devOrgsGet(client).catch(() => ({} as DevOrgGetResponse)),
    devUsersSelfGeneric(client).catch(() => ({} as DevUserSelfResponse)),
  ]);
  const org = orgRes.dev_org;
  const user = selfRes.dev_user;
  return {
    orgName: org?.display_name ?? org?.dev_slug ?? "unknown",
    orgSlug: org?.dev_slug ?? "unknown",
    orgDisplayId: org?.display_id ?? "unknown",
    userName: user?.full_name ?? user?.display_handle ?? "unknown",
    userEmail: user?.email ?? "unknown",
  };
}

/** One-line org banner for CLI output. */
export function formatOrgBanner(id: OrgIdentity, label?: string): string {
  const prefix = label ? `${label}: ` : "";
  return `${prefix}${id.orgName} (${id.orgDisplayId}) — ${id.userName} <${id.userEmail}>`;
}
