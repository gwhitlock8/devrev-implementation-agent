import type { DevRevHttpClient } from "./client.js";

export type WorkRecord = {
  id?: string;
  display_id?: string;
  type?: string;
  title?: string;
  external_ref?: string;
  sprint?: { id?: string; name?: string; type?: string } | null;
};

export async function worksCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ work?: WorkRecord }> {
  return client.post("works.create", body);
}

export async function worksUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ work?: WorkRecord }> {
  return client.post("works.update", body);
}

export async function worksListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ works?: WorkRecord[]; next_cursor?: string; prev_cursor?: string }> {
  return client.post("works.list", body);
}

export async function worksGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ work?: WorkRecord }> {
  return client.get("works.get", { id });
}

/** Resolve an existing work by DevRev `external_ref` (used for idempotent re-runs). */
export async function findWorkByExternalRef(
  client: DevRevHttpClient,
  workType: string,
  externalRef: string,
): Promise<WorkRecord | undefined> {
  const res = await worksListPost(client, {
    type: [workType],
    external_ref: [externalRef],
    limit: 10,
    mode: "after",
  });
  for (const w of res.works ?? []) {
    if (w.external_ref === externalRef) return w;
  }
  return undefined;
}
