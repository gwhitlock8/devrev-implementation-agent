import type { DevRevHttpClient } from "./client.js";

export async function linksCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ link?: Record<string, unknown> }> {
  return client.post("links.create", body);
}

export async function linksList(
  client: DevRevHttpClient,
  query?: Record<string, string | number | boolean | string[] | undefined>,
): Promise<{ links?: Record<string, unknown>[]; next_cursor?: string }> {
  return client.get("links.list", query);
}
