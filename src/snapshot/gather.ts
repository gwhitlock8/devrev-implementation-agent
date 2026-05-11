/**
 * Snapshot gatherer — reads a live DevRev org and maps objects back into
 * the Blueprint JSON shape so they can be re-applied to a fresh org.
 *
 * What is captured:
 *   parts (products, capabilities, features, enhancements)
 *   tags
 *   custom stages
 *   groups
 *   accounts + rev_orgs + rev_users  (up to configurable caps)
 *   works (tickets + issues, up to cap)
 *   articles (up to cap)
 *
 * What is intentionally omitted:
 *   timeline entries   — ephemeral conversation data; not useful in a template
 *   SLA policies       — no public list endpoint as of this writing
 *   links              — require both source and target to already exist; tricky to replay
 *   plug_config        — org-level setting, not portable without manual re-config
 *   CSV bindings       — live data doesn't need re-generation
 *   generate_conversations — same reason
 */

import { ReadOnlyDevRevClient } from "../api/readOnlyClient.js";
import type { Blueprint } from "../parsers/blueprint.js";

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

async function listAll<T>(
  client: ReadOnlyDevRevClient,
  endpoint: string,
  resultKey: string,
  body: Record<string, unknown> = {},
  maxPages = 10,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const req: Record<string, unknown> = { ...body, limit: 100 };
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
// Parts
// ---------------------------------------------------------------------------

type RawPart = Record<string, unknown>;

function slugify(id: string, name: string, type: string): string {
  const prefix = type.slice(0, 4); // prod, capa, feat, enha
  const clean = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  return `${prefix}:${clean || id}`;
}

async function gatherParts(
  client: ReadOnlyDevRevClient,
  onProgress?: (msg: string) => void,
): Promise<{ parts: Blueprint["parts"]; idToRef: Map<string, string> }> {
  onProgress?.("Listing parts…");
  const raw = await listAll<RawPart>(client, "parts.list", "parts", {});

  const idToRef = new Map<string, string>();
  const refCounts = new Map<string, number>();

  // First pass: assign unique refs
  for (const p of raw) {
    const id = p.id as string;
    const name = (p.name as string | undefined) ?? "";
    const type = (p.type as string | undefined) ?? "feature";
    let ref = slugify(id, name, type);
    // Deduplicate refs
    const count = (refCounts.get(ref) ?? 0) + 1;
    refCounts.set(ref, count);
    if (count > 1) ref = `${ref}-${count}`;
    idToRef.set(id, ref);
  }

  // Build a DON ID → ref lookup for parent resolution
  const parts: NonNullable<Blueprint["parts"]> = raw.map((p) => {
    const id = p.id as string;
    const ref = idToRef.get(id)!;
    const typeRaw = (p.type as string | undefined) ?? "feature";
    const VALID_PART_TYPES = new Set(["product", "capability", "feature", "enhancement", "linkable", "runnable"]);
    const type = (VALID_PART_TYPES.has(typeRaw) ? typeRaw : "feature") as
      "product" | "capability" | "feature" | "enhancement" | "linkable" | "runnable";
    const parentPart = p.parent_part as { id?: string } | undefined;
    const parentId = parentPart?.id;
    const parentRef = parentId ? idToRef.get(parentId) : undefined;

    return {
      ref,
      type,
      name: (p.name as string | undefined) ?? "(unnamed)",
      description: p.description as string | undefined,
      ...(parentRef ? { parent_ref: parentRef } : {}),
    };
  });

  return { parts, idToRef };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function gatherTags(
  client: ReadOnlyDevRevClient,
  onProgress?: (msg: string) => void,
): Promise<{ tags: Blueprint["tags"]; nameToRef: Map<string, string> }> {
  onProgress?.("Listing tags…");
  const raw = await listAll<Record<string, unknown>>(client, "tags.list", "tags", {});

  const nameToRef = new Map<string, string>();
  const tags: NonNullable<Blueprint["tags"]> = raw.map((t) => {
    const name = (t.name as string | undefined) ?? (t.id as string);
    const ref = `tag:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
    nameToRef.set(name, ref);
    return {
      ref,
      name,
      description: t.description as string | undefined,
    };
  });

  return { tags, nameToRef };
}

// ---------------------------------------------------------------------------
// Custom stages
// ---------------------------------------------------------------------------

async function gatherCustomStages(
  client: ReadOnlyDevRevClient,
  onProgress?: (msg: string) => void,
): Promise<Blueprint["custom_stages"]> {
  onProgress?.("Listing custom stages…");
  try {
    const res = await client.post<Record<string, unknown>>("stages.custom.list", { limit: 100 });
    const raw = (res.result as Record<string, unknown>[] | undefined) ?? [];

    // Filter to user-created stages only (exclude DevRev built-ins like triage, backlog, etc.)
    const BUILTIN_NAMES = new Set([
      "triage", "backlog", "in_development", "in development", "completed",
      "cancelled", "canceled", "wont fix", "won't fix",
    ]);

    return raw
      .filter((s) => {
        const name = (s.name as string | undefined) ?? "";
        return !BUILTIN_NAMES.has(name.toLowerCase());
      })
      .map((s) => {
        const name = (s.name as string | undefined) ?? "Custom Stage";
        const stateObj = s.state as { name?: string } | undefined;
        const stateName = (stateObj?.name ?? "open") as "open" | "in_progress" | "closed";
        const ref = `stage:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
        return {
          ref,
          name,
          description: s.description as string | undefined,
          state: stateName,
          ordinal: (s.ordinal as number | undefined) ?? 500,
        };
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function gatherGroups(
  client: ReadOnlyDevRevClient,
  onProgress?: (msg: string) => void,
): Promise<Blueprint["groups"]> {
  onProgress?.("Listing groups…");
  try {
    const raw = await listAll<Record<string, unknown>>(client, "groups.list", "groups", {});
    return raw.map((g) => {
      const name = (g.name as string | undefined) ?? "Group";
      const ref = `grp:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
      return {
        ref,
        name,
        description: g.description as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function gatherAccounts(
  client: ReadOnlyDevRevClient,
  cap: number,
  onProgress?: (msg: string) => void,
): Promise<{ accounts: Blueprint["accounts"]; idToRef: Map<string, string> }> {
  onProgress?.("Listing accounts…");
  const raw = await listAll<Record<string, unknown>>(client, "accounts.list", "accounts", {});
  const capped = raw.slice(0, cap);

  const idToRef = new Map<string, string>();
  const accounts: NonNullable<Blueprint["accounts"]> = capped.map((a) => {
    const id = a.id as string;
    const name = (a.display_name as string | undefined) ?? (a.name as string | undefined) ?? "Account";
    const ref = `acct:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
    idToRef.set(id, ref);
    return {
      ref,
      display_name: name,
      description: a.description as string | undefined,
      domains: a.domains as string[] | undefined,
    };
  });

  return { accounts, idToRef };
}

// ---------------------------------------------------------------------------
// Rev orgs
// ---------------------------------------------------------------------------

async function gatherRevOrgs(
  client: ReadOnlyDevRevClient,
  accountIdToRef: Map<string, string>,
  cap: number,
  onProgress?: (msg: string) => void,
): Promise<{ rev_orgs: Blueprint["rev_orgs"]; idToRef: Map<string, string> }> {
  onProgress?.("Listing rev orgs…");
  try {
    const raw = await listAll<Record<string, unknown>>(client, "rev-orgs.list", "rev_orgs", {});
    const capped = raw.slice(0, cap);
    const idToRef = new Map<string, string>();

    const rev_orgs: NonNullable<Blueprint["rev_orgs"]> = capped.map((ro) => {
      const id = ro.id as string;
      const name = (ro.display_name as string | undefined) ?? "Rev Org";
      const ref = `ro:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
      idToRef.set(id, ref);

      const accountObj = ro.account as { id?: string } | undefined;
      const accountRef = accountObj?.id ? accountIdToRef.get(accountObj.id) : undefined;

      return {
        ref,
        display_name: name,
        ...(accountRef ? { account_ref: accountRef } : {}),
        domains: ro.domains as string[] | undefined,
        external_ref: ro.external_ref as string | undefined,
      };
    });

    return { rev_orgs, idToRef };
  } catch {
    return { rev_orgs: [], idToRef: new Map() };
  }
}

// ---------------------------------------------------------------------------
// Rev users
// ---------------------------------------------------------------------------

async function gatherRevUsers(
  client: ReadOnlyDevRevClient,
  revOrgIdToRef: Map<string, string>,
  accountIdToRef: Map<string, string>,
  cap: number,
  onProgress?: (msg: string) => void,
): Promise<Blueprint["rev_users"]> {
  onProgress?.("Listing rev users…");
  try {
    const res = await client.get<Record<string, unknown>>("rev-users.list", { limit: "100" });
    const raw = (res.rev_users as Record<string, unknown>[] | undefined) ?? [];
    const capped = raw.slice(0, cap);

    return capped.map((ru) => {
      const name = (ru.display_name as string | undefined) ?? (ru.email as string | undefined) ?? "User";
      const ref = `ru:${name.toLowerCase().replace(/[^a-z0-9@.]+/g, "-").slice(0, 30)}`;

      const revOrgObj = ru.rev_org as { id?: string } | undefined;
      const revOrgRef = revOrgObj?.id ? revOrgIdToRef.get(revOrgObj.id) : undefined;

      const accountObj = ru.account as { id?: string } | undefined;
      const accountRef = accountObj?.id ? accountIdToRef.get(accountObj.id) : undefined;

      return {
        ref,
        display_name: ru.display_name as string | undefined,
        email: ru.email as string | undefined,
        ...(revOrgRef ? { rev_org_ref: revOrgRef } : {}),
        ...(accountRef ? { account_ref: accountRef } : {}),
        external_ref: ru.external_ref as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Works (tickets + issues)
// ---------------------------------------------------------------------------

function priorityNumToString(p: unknown): "p0" | "p1" | "p2" | "p3" | undefined {
  const n = Number(p);
  if (n === 1) return "p0";
  if (n === 2) return "p1";
  if (n === 3) return "p2";
  if (n === 4) return "p3";
  return undefined;
}

async function gatherWorks(
  client: ReadOnlyDevRevClient,
  partIdToRef: Map<string, string>,
  cap: number,
  onProgress?: (msg: string) => void,
): Promise<Blueprint["works"]> {
  onProgress?.("Listing tickets…");
  const tickets = await listAll<Record<string, unknown>>(
    client, "works.list", "works", { type: ["ticket"] },
  );
  onProgress?.("Listing issues…");
  const issues = await listAll<Record<string, unknown>>(
    client, "works.list", "works", { type: ["issue"] },
  );

  const all = [...tickets, ...issues].slice(0, cap);

  return all.map((w) => {
    const type = (w.type as string | undefined) ?? "ticket";
    if (type !== "ticket" && type !== "issue" && type !== "task" && type !== "opportunity") {
      return null;
    }
    const ref = `work:${((w.display_id as string | undefined) ?? (w.id as string)).replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

    const partObj = w.applies_to_part as { id?: string } | undefined;
    const partRef = partObj?.id ? partIdToRef.get(partObj.id) : undefined;

    return {
      ref,
      type: type as "ticket" | "issue" | "task" | "opportunity",
      title: (w.title as string | undefined) ?? "(no title)",
      body: w.body as string | undefined,
      priority: priorityNumToString(w.priority_v2),
      ...(partRef ? { applies_to_part_ref: partRef } : {}),
      external_ref: w.external_ref as string | undefined,
    };
  }).filter((w): w is NonNullable<typeof w> => w !== null);
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

async function gatherArticles(
  client: ReadOnlyDevRevClient,
  partIdToRef: Map<string, string>,
  cap: number,
  onProgress?: (msg: string) => void,
): Promise<Blueprint["articles"]> {
  onProgress?.("Listing articles…");
  const raw = await listAll<Record<string, unknown>>(client, "articles.list", "articles", {});
  const capped = raw.slice(0, cap);

  return capped.map((a) => {
    const title = (a.title as string | undefined) ?? "(untitled)";
    const ref = `art:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;

    const partObj = a.applies_to_part as { id?: string } | undefined;
    const partRef = partObj?.id ? partIdToRef.get(partObj.id) : undefined;

    const statusRaw = a.status as string | undefined;
    const status = statusRaw === "draft" || statusRaw === "published" ? statusRaw : undefined;

    return {
      ref,
      title,
      body: a.body as string | undefined,
      status,
      language: a.language as string | undefined,
      ...(partRef ? { applies_to_part_ref: partRef } : {}),
      external_ref: a.external_ref as string | undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type SnapshotOptions = {
  /** Max accounts to include (default 20) */
  maxAccounts?: number;
  /** Max rev orgs to include (default 30) */
  maxRevOrgs?: number;
  /** Max rev users to include (default 50) */
  maxRevUsers?: number;
  /** Max works (tickets + issues combined) to include (default 50) */
  maxWorks?: number;
  /** Max articles to include (default 40) */
  maxArticles?: number;
  /** If true, omit works (tickets/issues) from the snapshot */
  noWorks?: boolean;
  /** If true, omit accounts/rev_orgs/rev_users from the snapshot */
  noCustomers?: boolean;
};

export type SnapshotResult = {
  blueprint: Blueprint;
  stats: {
    parts: number;
    tags: number;
    custom_stages: number;
    groups: number;
    accounts: number;
    rev_orgs: number;
    rev_users: number;
    works: number;
    articles: number;
  };
};

export async function gatherSnapshot(
  client: ReadOnlyDevRevClient,
  orgName: string,
  opts: SnapshotOptions = {},
  onProgress?: (msg: string) => void,
): Promise<SnapshotResult> {
  const {
    maxAccounts = 20,
    maxRevOrgs = 30,
    maxRevUsers = 50,
    maxWorks = 50,
    maxArticles = 40,
    noWorks = false,
    noCustomers = false,
  } = opts;

  const { parts, idToRef: partIdToRef } = await gatherParts(client, onProgress);
  const { tags } = await gatherTags(client, onProgress);
  const custom_stages = await gatherCustomStages(client, onProgress);
  const groups = await gatherGroups(client, onProgress);

  let accounts: Blueprint["accounts"] = [];
  let rev_orgs: Blueprint["rev_orgs"] = [];
  let rev_users: Blueprint["rev_users"] = [];
  let accountIdToRef = new Map<string, string>();
  let revOrgIdToRef = new Map<string, string>();

  if (!noCustomers) {
    ({ accounts, idToRef: accountIdToRef } = await gatherAccounts(client, maxAccounts, onProgress));
    ({ rev_orgs, idToRef: revOrgIdToRef } = await gatherRevOrgs(client, accountIdToRef, maxRevOrgs, onProgress));
    rev_users = await gatherRevUsers(client, revOrgIdToRef, accountIdToRef, maxRevUsers, onProgress);
  }

  let works: Blueprint["works"] = [];
  if (!noWorks) {
    works = await gatherWorks(client, partIdToRef, maxWorks, onProgress);
  }

  const articles = await gatherArticles(client, partIdToRef, maxArticles, onProgress);

  const blueprint: Blueprint = {
    name: `${orgName} — snapshot`,
    description: `Live org snapshot captured from ${orgName}. Parts hierarchy, tags, stages, groups, accounts, and works are preserved as blueprint objects. Apply to a fresh org to seed a new environment that mirrors this one.`,
    defaults: {
      owned_by: ["SELF"],
    },
    ...(parts?.length ? { parts } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(custom_stages?.length ? { custom_stages } : {}),
    ...(groups?.length ? { groups } : {}),
    ...(accounts?.length ? { accounts } : {}),
    ...(rev_orgs?.length ? { rev_orgs } : {}),
    ...(rev_users?.length ? { rev_users } : {}),
    ...(works?.length ? { works } : {}),
    ...(articles?.length ? { articles } : {}),
  };

  return {
    blueprint,
    stats: {
      parts: parts?.length ?? 0,
      tags: tags?.length ?? 0,
      custom_stages: custom_stages?.length ?? 0,
      groups: groups?.length ?? 0,
      accounts: accounts?.length ?? 0,
      rev_orgs: rev_orgs?.length ?? 0,
      rev_users: rev_users?.length ?? 0,
      works: works?.length ?? 0,
      articles: articles?.length ?? 0,
    },
  };
}
