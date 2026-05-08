import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DevRevHttpClient, DevRevHttpError } from "../api/client.js";
import { accountsGet, accountsListPost } from "../api/accounts.js";
import { articlesGet, articlesListPost } from "../api/articles.js";
import { incidentsGet, incidentsList } from "../api/incidents.js";
import { partsGet, partsListPost } from "../api/parts.js";
import { revOrgsGet } from "../api/revOrgs.js";
import { revUsersGet, revUsersList } from "../api/revUsers.js";
import { worksGet, worksListPost } from "../api/works.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";

type SearchHit = {
  type: "account" | "part" | "work" | "rev_user" | "incident" | "article";
  id?: string;
  display_id?: string;
  name?: string;
};

function nameMatches(needle: string, hay: string | undefined): boolean {
  if (!hay) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

type SearchableType = "account" | "part" | "work" | "rev_user" | "incident" | "article";

const ALL_TYPES: SearchableType[] = [
  "account",
  "part",
  "work",
  "rev_user",
  "incident",
  "article",
];

const PAGE_LIMIT = 50;
const MAX_PAGES = 4; // 50 × 4 = 200 per type

/** Page through a POST list endpoint until exhausted or MAX_PAGES reached. */
async function paginatePost<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; next_cursor?: string } | null>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(cursor);
    if (!page) break;
    out.push(...page.items);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

async function searchAcrossTypes(
  client: DevRevHttpClient,
  query: string,
  limit: number,
  types: SearchableType[],
): Promise<SearchHit[]> {
  const want = new Set(types);
  const tasks = await Promise.all([
    want.has("account")
      ? paginatePost(async (cursor) => {
          const r = await safe(accountsListPost(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.accounts ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
    want.has("part")
      ? paginatePost(async (cursor) => {
          const r = await safe(partsListPost(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.parts ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
    want.has("work")
      ? paginatePost(async (cursor) => {
          const r = await safe(worksListPost(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.works ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
    want.has("rev_user")
      ? paginatePost(async (cursor) => {
          const r = await safe(revUsersList(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.rev_users ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
    want.has("incident")
      ? paginatePost(async (cursor) => {
          const r = await safe(incidentsList(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.incidents ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
    want.has("article")
      ? paginatePost(async (cursor) => {
          const r = await safe(articlesListPost(client, { limit: PAGE_LIMIT, cursor }));
          if (!r) return null;
          return { items: r.articles ?? [], next_cursor: r.next_cursor };
        })
      : Promise.resolve([]),
  ]);
  const [accounts, parts, works, revUsers, incidents, articles] = tasks;

  const hits: SearchHit[] = [];
  for (const a of accounts) {
    if (nameMatches(query, a.display_name) || nameMatches(query, a.display_id)) {
      hits.push({ type: "account", id: a.id, display_id: a.display_id, name: a.display_name });
    }
  }
  for (const p of parts) {
    if (nameMatches(query, p.name) || nameMatches(query, p.display_id)) {
      hits.push({ type: "part", id: p.id, display_id: p.display_id, name: p.name });
    }
  }
  for (const w of works) {
    if (nameMatches(query, w.title) || nameMatches(query, w.display_id)) {
      hits.push({ type: "work", id: w.id, display_id: w.display_id, name: w.title });
    }
  }
  for (const r of revUsers) {
    if (
      nameMatches(query, r.display_name) ||
      nameMatches(query, r.email) ||
      nameMatches(query, r.display_id)
    ) {
      hits.push({ type: "rev_user", id: r.id, display_id: r.display_id, name: r.display_name });
    }
  }
  for (const inc of incidents) {
    if (nameMatches(query, inc.title) || nameMatches(query, inc.display_id)) {
      hits.push({ type: "incident", id: inc.id, display_id: inc.display_id, name: inc.title });
    }
  }
  for (const a of articles) {
    if (nameMatches(query, a.title) || nameMatches(query, a.display_id)) {
      hits.push({ type: "article", id: a.id, display_id: a.display_id, name: a.title });
    }
  }
  return hits.slice(0, limit);
}

type GetResult = { type: string; data: unknown } | { error: string };

async function getObjectByPrefix(
  client: DevRevHttpClient,
  id: string,
): Promise<GetResult> {
  const upper = id.toUpperCase();
  const tryWrap = async <T>(type: string, fn: () => Promise<T>): Promise<GetResult> => {
    try {
      return { type, data: await fn() };
    } catch (e) {
      const msg = e instanceof DevRevHttpError ? `${e.message}: ${e.bodyText.slice(0, 300)}` : e instanceof Error ? e.message : String(e);
      return { error: `${type}.get failed for ${id}: ${msg}` };
    }
  };
  if (upper.startsWith("ACC-") || upper.includes(":account/")) {
    return tryWrap("account", () => accountsGet(client, id));
  }
  if (
    upper.startsWith("PROD-") ||
    upper.startsWith("CAP-") ||
    upper.startsWith("FEAT-") ||
    upper.startsWith("ENH-") ||
    upper.startsWith("LIN-") ||
    upper.startsWith("RUN-") ||
    upper.includes(":product/") ||
    upper.includes(":capability/") ||
    upper.includes(":feature/") ||
    upper.includes(":enhancement/")
  ) {
    return tryWrap("part", () => partsGet(client, id));
  }
  if (upper.startsWith("TKT-") || upper.startsWith("ISS-") || upper.includes(":ticket/") || upper.includes(":issue/")) {
    return tryWrap("work", () => worksGet(client, id));
  }
  if (upper.startsWith("INC-") || upper.includes(":incident/")) {
    return tryWrap("incident", () => incidentsGet(client, id));
  }
  if (upper.startsWith("REVU-") || upper.includes(":rev-user/")) {
    return tryWrap("rev_user", () => revUsersGet(client, id));
  }
  if (upper.startsWith("REVO-") || upper.includes(":rev-org/") || upper.startsWith("ORG-")) {
    return tryWrap("rev_org", () => revOrgsGet(client, id));
  }
  if (
    upper.startsWith("ART-") ||
    upper.startsWith("ARTICLE-") ||
    upper.startsWith("KB-") ||
    upper.includes(":article/")
  ) {
    return tryWrap("article", () => articlesGet(client, id));
  }
  return {
    error: `Could not infer object type from id "${id}". Supported prefixes: ACC-, PROD-, CAP-, FEAT-, ENH-, LIN-, RUN-, TKT-, ISS-, INC-, REVU-, ART-/ARTICLE-/KB-.`,
  };
}

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createDevRevMcpServer(client: DevRevHttpClient): McpServer {
  const server = new McpServer({ name: "devrev-impl-agent-mcp", version: "0.2.0" });

  server.registerTool(
    "search",
    {
      description:
        "Search the DevRev org for objects whose name/title/email contains the query. " +
        "Pages up to 200 objects per type. Pass `types` to scope the search and avoid " +
        "fetching object kinds you don't care about.",
      inputSchema: {
        query: z.string().describe("Free-text query, matched against names/titles/emails."),
        types: z
          .array(z.enum(["account", "part", "work", "rev_user", "incident", "article"]))
          .optional()
          .describe("Object kinds to search. Defaults to all six."),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max hits to return (default 20)."),
      },
    },
    async ({ query, types, limit }) => {
      const wantTypes: SearchableType[] = types?.length
        ? (types as SearchableType[])
        : ALL_TYPES;
      const hits = await searchAcrossTypes(client, query, limit ?? 20, wantTypes);
      return {
        content: [
          {
            type: "text",
            text: hits.length
              ? asJsonText({ count: hits.length, hits })
              : "(no matches)",
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_object",
    {
      description:
        "Fetch a DevRev object by id (DON or display_id, e.g. ACC-1, PROD-2, TKT-3). Type is inferred from the id prefix.",
      inputSchema: {
        id: z.string().describe("DevRev object id or display_id."),
      },
    },
    async ({ id }) => {
      const r = await getObjectByPrefix(client, id);
      if ("error" in r) {
        return {
          content: [{ type: "text", text: r.error }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: asJsonText(r) }],
      };
    },
  );

  return server;
}

export async function runDevRevMcpServer(): Promise<void> {
  loadEnvFiles();
  const pat = requireEnv("DEVREV_PAT");
  const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
  const client = new DevRevHttpClient({ pat, betaScope: beta });
  const server = createDevRevMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
