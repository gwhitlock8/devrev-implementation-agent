import type { DevRevHttpClient } from "./client.js";
import { worksListPost } from "./works.js";

export type SprintSummary = {
  id: string;
  name: string;
};

/**
 * DevRev does not document a dedicated public `sprints.list` in the developer portal.
 * We aggregate sprint objects referenced by issues returned from `works.list` (POST),
 * which may omit empty sprints. See docs: https://developer.devrev.ai/api-reference/works/list-post
 */
export async function listSprintsReferencedByWorks(
  client: DevRevHttpClient,
  options?: { maxPages?: number; pageSize?: number },
): Promise<SprintSummary[]> {
  const maxPages = options?.maxPages ?? 50;
  const limit = options?.pageSize ?? 100;
  const byId = new Map<string, SprintSummary>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      limit,
      mode: "after",
      ...(cursor ? { cursor } : {}),
    };
    const res = await worksListPost(client, body);
    for (const w of res.works ?? []) {
      const sp = w.sprint;
      const id = sp?.id;
      if (id) {
        byId.set(id, { id, name: sp?.name ?? id });
      }
    }
    const next = res.next_cursor;
    if (typeof next === "string" && next.length > 0) cursor = next;
    else break;
    if ((res.works ?? []).length === 0) break;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
