import type { ReadOnlyDevRevClient } from "../api/readOnlyClient.js";

/**
 * Research data gatherer — uses DevRev's native APIs (list, search, get)
 * to collect structured data about accounts, tickets, parts, articles, etc.
 * All operations are read-only.
 */

export type ResearchContext = {
  query: string;
  accounts: AccountSummary[];
  recentTickets: WorkSummary[];
  recentIssues: WorkSummary[];
  articles: ArticleSummary[];
  parts: PartSummary[];
  /** Raw search results for semantic matching. */
  searchResults: SearchHit[];
};

export type AccountSummary = {
  id: string;
  displayId?: string;
  name?: string;
  domains?: string[];
  tier?: string;
  owner?: string;
};

export type WorkSummary = {
  id: string;
  displayId?: string;
  title?: string;
  type?: string;
  severity?: string;
  priority?: number;
  stage?: string;
  createdDate?: string;
  tags?: string[];
};

export type ArticleSummary = {
  id: string;
  displayId?: string;
  title?: string;
  status?: string;
};

export type PartSummary = {
  id: string;
  displayId?: string;
  name?: string;
  type?: string;
  parentId?: string;
};

export type SearchHit = {
  id: string;
  type: string;
  title: string;
  snippet: string;
};

// ---------------------------------------------------------------------------
// Paginated list helper
// ---------------------------------------------------------------------------

async function listAll<T>(
  client: ReadOnlyDevRevClient,
  endpoint: string,
  resultKey: string,
  body: Record<string, unknown> = {},
  maxPages = 5,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const req: Record<string, unknown> = { ...body };
    if (cursor) req.cursor = cursor;
    const res = await client.post<Record<string, unknown>>(endpoint, req);
    const items = (res[resultKey] as T[] | undefined) ?? [];
    all.push(...items);
    cursor = res.next_cursor as string | undefined;
    if (!cursor || items.length === 0) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Account lookup
// ---------------------------------------------------------------------------

async function findAccounts(
  client: ReadOnlyDevRevClient,
  query: string,
): Promise<AccountSummary[]> {
  // Search for accounts by name using DevRev's search endpoint.
  try {
    const res = await client.post<Record<string, unknown>>("accounts.list", {});
    const accounts = (res.accounts as Record<string, unknown>[]) ?? [];
    // Filter by query terms (case-insensitive partial match on name/domain).
    const terms = query.toLowerCase().split(/\s+/);
    return accounts
      .filter((a) => {
        const name = ((a.display_name ?? a.name ?? "") as string).toLowerCase();
        const domains = ((a.domains as string[]) ?? []).join(" ").toLowerCase();
        return terms.some((t) => name.includes(t) || domains.includes(t));
      })
      .slice(0, 10)
      .map((a) => ({
        id: a.id as string,
        displayId: a.display_id as string | undefined,
        name: (a.display_name ?? a.name) as string | undefined,
        domains: a.domains as string[] | undefined,
        tier: a.tier as string | undefined,
        owner: extractOwnerName(a.owned_by),
      }));
  } catch {
    return [];
  }
}

function extractOwnerName(ownedBy: unknown): string | undefined {
  if (!Array.isArray(ownedBy) || ownedBy.length === 0) return undefined;
  const first = ownedBy[0];
  if (typeof first === "object" && first !== null) {
    return (first as Record<string, unknown>).full_name as string | undefined
      ?? (first as Record<string, unknown>).display_name as string | undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Recent works (tickets + issues)
// ---------------------------------------------------------------------------

async function findRecentWorks(
  client: ReadOnlyDevRevClient,
  type: "ticket" | "issue",
  limit = 25,
): Promise<WorkSummary[]> {
  try {
    const works = await listAll<Record<string, unknown>>(
      client, "works.list", "works", { type: [type] }, 2,
    );
    return works.slice(0, limit).map((w) => ({
      id: w.id as string,
      displayId: w.display_id as string | undefined,
      title: w.title as string | undefined,
      type: w.type as string | undefined,
      severity: w.severity as string | undefined,
      priority: w.priority_v2 as number | undefined,
      stage: extractStageName(w.stage),
      createdDate: w.created_date as string | undefined,
      tags: extractTagNames(w.tags),
    }));
  } catch {
    return [];
  }
}

function extractStageName(stage: unknown): string | undefined {
  if (typeof stage === "object" && stage !== null) {
    return (stage as Record<string, unknown>).name as string | undefined;
  }
  return undefined;
}

function extractTagNames(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  return tags
    .map((t) => {
      if (typeof t === "object" && t !== null) {
        return (t as Record<string, unknown>).name as string ?? (t as Record<string, unknown>).id as string;
      }
      return String(t);
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

async function findArticles(
  client: ReadOnlyDevRevClient,
  limit = 30,
): Promise<ArticleSummary[]> {
  try {
    const articles = await listAll<Record<string, unknown>>(
      client, "articles.list", "articles", {}, 2,
    );
    return articles.slice(0, limit).map((a) => ({
      id: a.id as string,
      displayId: a.display_id as string | undefined,
      title: a.title as string | undefined,
      status: a.status as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

async function findParts(
  client: ReadOnlyDevRevClient,
): Promise<PartSummary[]> {
  try {
    const parts = await listAll<Record<string, unknown>>(
      client, "parts.list", "parts", {}, 3,
    );
    return parts.map((p) => ({
      id: p.id as string,
      displayId: p.display_id as string | undefined,
      name: p.name as string | undefined,
      type: p.type as string | undefined,
      parentId: extractParentId(p.parent_part),
    }));
  } catch {
    return [];
  }
}

function extractParentId(parent: unknown): string | undefined {
  if (typeof parent === "object" && parent !== null) {
    return (parent as Record<string, unknown>).display_id as string | undefined
      ?? (parent as Record<string, unknown>).id as string | undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// MCP-style search (if the org has a search endpoint)
// ---------------------------------------------------------------------------

async function semanticSearch(
  _client: ReadOnlyDevRevClient,
  _query: string,
): Promise<SearchHit[]> {
  // DevRev doesn't have a public unified search endpoint on the REST API,
  // but we can use works.list + articles.list with keyword matching as a
  // pragmatic alternative. The MCP search is richer, but we avoid the MCP
  // dependency for the research PAT to keep it simple.
  return [];
}

// ---------------------------------------------------------------------------
// Main gather function
// ---------------------------------------------------------------------------

export async function gatherResearchContext(
  client: ReadOnlyDevRevClient,
  query: string,
  onProgress?: (msg: string) => void,
): Promise<ResearchContext> {
  onProgress?.("Searching accounts…");
  const accounts = await findAccounts(client, query);

  onProgress?.("Loading recent tickets…");
  const recentTickets = await findRecentWorks(client, "ticket");

  onProgress?.("Loading recent issues…");
  const recentIssues = await findRecentWorks(client, "issue");

  onProgress?.("Loading KB articles…");
  const articles = await findArticles(client);

  onProgress?.("Loading parts hierarchy…");
  const parts = await findParts(client);

  const searchResults = await semanticSearch(client, query);

  return {
    query,
    accounts,
    recentTickets,
    recentIssues,
    articles,
    parts,
    searchResults,
  };
}

// ---------------------------------------------------------------------------
// Format context for Claude synthesis
// ---------------------------------------------------------------------------

export function formatResearchContext(ctx: ResearchContext): string {
  const sections: string[] = [];

  sections.push(`# Research query\n${ctx.query}`);

  if (ctx.accounts.length > 0) {
    sections.push(`# Matching accounts (${ctx.accounts.length})\n` +
      ctx.accounts.map((a) =>
        `- ${a.name ?? a.displayId ?? a.id}` +
        (a.domains?.length ? ` (${a.domains.join(", ")})` : "") +
        (a.tier ? ` — tier: ${a.tier}` : "") +
        (a.owner ? ` — owner: ${a.owner}` : ""),
      ).join("\n"),
    );
  } else {
    sections.push("# Matching accounts\nNone found.");
  }

  if (ctx.recentTickets.length > 0) {
    sections.push(`# Recent tickets (${ctx.recentTickets.length})\n` +
      ctx.recentTickets.slice(0, 15).map((t) =>
        `- ${t.displayId ?? t.id}: ${t.title ?? "(no title)"}` +
        (t.severity ? ` [${t.severity}]` : "") +
        (t.stage ? ` — ${t.stage}` : "") +
        (t.tags?.length ? ` (${t.tags.join(", ")})` : ""),
      ).join("\n"),
    );
  }

  if (ctx.recentIssues.length > 0) {
    sections.push(`# Recent issues (${ctx.recentIssues.length})\n` +
      ctx.recentIssues.slice(0, 15).map((i) =>
        `- ${i.displayId ?? i.id}: ${i.title ?? "(no title)"}` +
        (i.priority ? ` [p${i.priority - 1}]` : "") +
        (i.stage ? ` — ${i.stage}` : "") +
        (i.tags?.length ? ` (${i.tags.join(", ")})` : ""),
      ).join("\n"),
    );
  }

  if (ctx.articles.length > 0) {
    sections.push(`# KB articles (${ctx.articles.length})\n` +
      ctx.articles.slice(0, 20).map((a) =>
        `- ${a.displayId ?? a.id}: ${a.title ?? "(no title)"}` +
        (a.status ? ` [${a.status}]` : ""),
      ).join("\n"),
    );
  }

  if (ctx.parts.length > 0) {
    sections.push(`# Parts hierarchy (${ctx.parts.length})\n` +
      ctx.parts.map((p) =>
        `- ${p.displayId ?? p.id}: ${p.name ?? "(unnamed)"} (${p.type ?? "?"})` +
        (p.parentId ? ` → parent: ${p.parentId}` : ""),
      ).join("\n"),
    );
  }

  return sections.join("\n\n");
}
