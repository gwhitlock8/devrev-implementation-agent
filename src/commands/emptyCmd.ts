import { DevRevHttpClient, DevRevHttpError } from "../api/client.js";
import { resolveOrgIdentity, formatOrgBanner } from "../api/devUsers.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";

export type EmptyCliArgs = {
  dryRun: boolean;
  json?: boolean;
  /** Skip the confirmation prompt (for scripted use). */
  yes?: boolean;
};

// ---------------------------------------------------------------------------
// Object discovery — list all user-created objects via the DevRev API
// ---------------------------------------------------------------------------

type DiscoveredObject = {
  id: string;
  displayId?: string;
  category: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  work: "Works",
  article: "Articles",
  tag: "Tags",
  group: "Groups",
  rev_user: "Rev users",
  rev_org: "Rev orgs",
  account: "Accounts",
  part: "Parts",
};

// Parts must be deleted leaf-first.
const PART_TYPE_ORDER = ["enhancement", "feature", "capability", "product"];

async function listAllPaginated<T>(
  client: DevRevHttpClient,
  endpoint: string,
  resultKey: string,
  body: Record<string, unknown> = {},
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
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

async function discoverObjects(client: DevRevHttpClient): Promise<DiscoveredObject[]> {
  const objects: DiscoveredObject[] = [];

  // Works (issues, tickets)
  const works = await listAllPaginated<Record<string, unknown>>(
    client, "works.list", "works", { type: ["issue", "ticket"] },
  );
  for (const w of works) {
    objects.push({
      id: w.id as string,
      displayId: (w.display_id as string) ?? undefined,
      category: "work",
    });
  }

  // Articles
  const articles = await listAllPaginated<Record<string, unknown>>(
    client, "articles.list", "articles",
  );
  for (const a of articles) {
    objects.push({
      id: a.id as string,
      displayId: (a.display_id as string) ?? undefined,
      category: "article",
    });
  }

  // Tags (exclude system tags)
  const tags = await listAllPaginated<Record<string, unknown>>(
    client, "tags.list", "tags",
  );
  for (const t of tags) {
    objects.push({
      id: t.id as string,
      displayId: (t.display_id as string) ?? undefined,
      category: "tag",
    });
  }

  // Groups (exclude default/system groups)
  const groups = await listAllPaginated<Record<string, unknown>>(
    client, "groups.list", "groups",
  );
  for (const g of groups) {
    if ((g as Record<string, unknown>).is_default) continue;
    objects.push({
      id: g.id as string,
      displayId: (g.display_id as string) ?? undefined,
      category: "group",
    });
  }

  // Accounts
  const accounts = await listAllPaginated<Record<string, unknown>>(
    client, "accounts.list", "accounts",
  );
  for (const a of accounts) {
    objects.push({
      id: a.id as string,
      displayId: (a.display_id as string) ?? undefined,
      category: "account",
    });
  }

  // Rev orgs — skip system/default rev orgs (they return 400 on delete).
  // User-created rev orgs have an `account` field or `external_ref`.
  const revOrgs = await listAllPaginated<Record<string, unknown>>(
    client, "rev-orgs.list", "rev_orgs",
  );
  for (const r of revOrgs) {
    // Skip rev orgs that have no account association — these are typically
    // system-created defaults that cannot be deleted.
    if (!r.account && !r.external_ref) continue;
    objects.push({
      id: r.id as string,
      displayId: (r.display_id as string) ?? undefined,
      category: "rev_org",
    });
  }

  // Parts (products, capabilities, features, enhancements)
  const parts = await listAllPaginated<Record<string, unknown>>(
    client, "parts.list", "parts",
  );
  // Sort parts leaf-first for safe deletion order.
  const sortedParts = [...parts].sort((a, b) => {
    const aType = partTypeRank(a.id as string);
    const bType = partTypeRank(b.id as string);
    return aType - bType;
  });
  for (const p of sortedParts) {
    objects.push({
      id: p.id as string,
      displayId: (p.display_id as string) ?? undefined,
      category: "part",
    });
  }

  return objects;
}

function partTypeRank(id: string): number {
  for (let i = 0; i < PART_TYPE_ORDER.length; i++) {
    if (id.includes(`${PART_TYPE_ORDER[i]}/`)) return i;
  }
  return PART_TYPE_ORDER.length;
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

// groups.delete is only on the internal gateway.
const DELETE_CONFIG: Record<string, { endpoint: string; internal?: boolean }> = {
  work: { endpoint: "works.delete" },
  article: { endpoint: "articles.delete" },
  tag: { endpoint: "tags.delete" },
  group: { endpoint: "groups.delete", internal: true },
  rev_user: { endpoint: "rev-users.delete" },
  rev_org: { endpoint: "rev-orgs.delete" },
  account: { endpoint: "accounts.delete" },
  part: { endpoint: "parts.delete" },
};

// Deletion order — dependents first.
const DELETE_ORDER = ["work", "article", "tag", "group", "rev_user", "rev_org", "account", "part"];

type EmptySummary = {
  deleted: number;
  failed: number;
  skipped: number;
  by_category: Record<string, { deleted: number; failed: number; skipped: number }>;
  failures: { id: string; message: string }[];
};

export async function emptyCommand(args: EmptyCliArgs): Promise<void> {
  loadEnvFiles();
  const pat = requireEnv("DEVREV_PAT");
  const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
  const client = new DevRevHttpClient({ pat, betaScope: beta });
  const internalClient = new DevRevHttpClient({
    pat,
    baseUrl: "https://app.devrev.ai/api/gateway/internal",
    betaScope: beta,
  });

  const orgId = await resolveOrgIdentity(client);
  if (!args.json) {
    console.log(`\n  Org: ${formatOrgBanner(orgId)}\n`);
  }

  console.log("Discovering objects in the org…");
  const objects = await discoverObjects(client);

  if (objects.length === 0) {
    const msg = "No user-created objects found in the org.";
    if (args.json) {
      process.stdout.write(JSON.stringify({ deleted: 0, failed: 0, skipped: 0, message: msg }) + "\n");
    } else {
      console.log(msg);
    }
    return;
  }

  // Count by category for the preview.
  const preview: Record<string, number> = {};
  for (const o of objects) {
    preview[o.category] = (preview[o.category] ?? 0) + 1;
  }

  if (!args.json) {
    console.log(`\nFound ${objects.length} object(s) to delete:\n`);
    for (const cat of DELETE_ORDER) {
      if (preview[cat]) {
        console.log(`  ${CATEGORY_LABELS[cat] ?? cat}: ${preview[cat]}`);
      }
    }
    console.log("");
  }

  if (args.dryRun) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ dry_run: true, would_delete: preview }) + "\n");
    } else {
      console.log("Dry run — no objects deleted.");
    }
    return;
  }

  // Confirmation gate.
  if (!args.yes) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("⚠️  This will delete ALL user-created objects. Type 'yes' to confirm: ", resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  // Sort objects by deletion order.
  const orderMap = new Map(DELETE_ORDER.map((c, i) => [c, i]));
  objects.sort((a, b) => (orderMap.get(a.category) ?? 999) - (orderMap.get(b.category) ?? 999));

  const summary: EmptySummary = { deleted: 0, failed: 0, skipped: 0, by_category: {}, failures: [] };

  const bump = (cat: string, field: "deleted" | "failed" | "skipped") => {
    if (!summary.by_category[cat]) summary.by_category[cat] = { deleted: 0, failed: 0, skipped: 0 };
    summary.by_category[cat][field]++;
  };

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const config = DELETE_CONFIG[obj.category];
    if (!config) {
      summary.skipped++;
      bump(obj.category, "skipped");
      continue;
    }

    const label = obj.displayId ?? obj.id;
    const n = `[${i + 1}/${objects.length}]`;

    try {
      const deleteClient = config.internal ? internalClient : client;
      await deleteClient.post(config.endpoint, { id: obj.id });
      summary.deleted++;
      bump(obj.category, "deleted");
      if (!args.json) {
        console.log(`  ✓ ${n} ${config.endpoint}  ${label}`);
      }
    } catch (err) {
      const is404 =
        (err instanceof DevRevHttpError && err.status === 404) ||
        (err instanceof DevRevHttpError && err.bodyText.includes("not_found"));
      if (is404) {
        summary.skipped++;
        bump(obj.category, "skipped");
        if (!args.json) {
          console.log(`  ~ ${n} ${config.endpoint}  ${label}  (already gone)`);
        }
      } else {
        const msg = err instanceof DevRevHttpError
          ? `HTTP ${err.status}: ${err.bodyText.slice(0, 200)}`
          : err instanceof Error ? err.message : String(err);
        summary.failed++;
        bump(obj.category, "failed");
        summary.failures.push({ id: obj.id, message: msg });
        if (!args.json) {
          console.error(`  ✗ ${n} ${config.endpoint}  ${label}  → ${msg}`);
        }
      }
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(summary) + "\n");
  } else {
    console.log(
      `\nDone: ${summary.deleted} deleted, ${summary.failed} failed, ${summary.skipped} skipped.`,
    );
    const cats = Object.entries(summary.by_category);
    if (cats.length > 0) {
      console.log("");
      for (const [cat, counts] of cats) {
        const label = CATEGORY_LABELS[cat] ?? cat;
        const parts: string[] = [];
        if (counts.deleted) parts.push(`${counts.deleted} deleted`);
        if (counts.skipped) parts.push(`${counts.skipped} skipped`);
        if (counts.failed) parts.push(`${counts.failed} failed`);
        console.log(`  ${label}: ${parts.join(", ")}`);
      }
    }
    if (summary.failures.length) {
      console.error("\nFailures:");
      for (const f of summary.failures) {
        console.error(`- ${f.id}: ${f.message}`);
      }
    }
  }
  if (summary.failures.length) process.exitCode = 1;
}
