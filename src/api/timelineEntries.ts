import type { DevRevHttpClient } from "./client.js";

export type TimelineEntryRecord = {
  id?: string;
  display_id?: string;
  type?: string;
  body?: string;
  visibility?: "external" | "internal" | "private";
};

export async function timelineEntriesCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ timeline_entry?: TimelineEntryRecord }> {
  return client.post("timeline-entries.create", body);
}
