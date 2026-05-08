import type { DevRevHttpClient } from "./client.js";

export type IncidentRecord = {
  id?: string;
  display_id?: string;
  title?: string;
};

export async function incidentsCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ incident?: IncidentRecord }> {
  return client.post("incidents.create", body);
}

export async function incidentsUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ incident?: IncidentRecord }> {
  return client.post("incidents.update", body);
}

export async function incidentsList(
  client: DevRevHttpClient,
  query?: Record<string, string | number | boolean | string[] | undefined>,
): Promise<{ incidents?: IncidentRecord[]; next_cursor?: string }> {
  return client.get("incidents.list", query);
}

export async function incidentsGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ incident?: IncidentRecord }> {
  return client.get("incidents.get", { id });
}
