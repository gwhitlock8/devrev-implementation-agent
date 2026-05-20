import { DevRevHttpClient, DevRevHttpError } from "../api/client.js";
import { resolveOrgIdentity, formatOrgBanner } from "../api/devUsers.js";
import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";
import { loadManifest, saveManifest, type RunManifest, type ManifestEntry } from "../executor/manifest.js";
import { AuditLogger, type AuditEntry } from "../logging/audit.js";
import { DEFAULT_OUTPUT_DIR } from "./planCmd.js";

export type CleanupCliArgs = {
  outputDir?: string;
  dryRun: boolean;
  /** Keep the parts hierarchy (products, capabilities, features, enhancements) intact. */
  keepParts: boolean;
  json?: boolean;
};

// ---------------------------------------------------------------------------
// Object-type inference from DON IDs
// ---------------------------------------------------------------------------

/** Map DON ID path segments to the DevRev delete endpoint + a human-readable category. */
type ObjectCategory =
  | "timeline_entry"
  | "link"
  | "work"
  | "article"
  | "vista"
  | "tag"
  | "custom_stage"
  | "group"
  | "rev_user"
  | "rev_org"
  | "account"
  | "part";

const DON_SEGMENT_MAP: [RegExp, ObjectCategory][] = [
  [/\btimeline_entry\//, "timeline_entry"],
  [/\blink\//, "link"],
  [/\b(ticket|issue|task|opportunity)\//, "work"],
  [/\barticle\//, "article"],
  [/\bvista\//, "vista"],
  [/\btag\//, "tag"],
  [/\bcustom_stage\//, "custom_stage"],
  [/\bgroup\//, "group"],
  [/\brev_user\//, "rev_user"],
  [/\brev_org\//, "rev_org"],
  [/\baccount\//, "account"],
  [/\b(product|capability|feature|enhancement)\//, "part"],
];

function categorize(id: string): ObjectCategory | undefined {
  for (const [re, cat] of DON_SEGMENT_MAP) {
    if (re.test(id)) return cat;
  }
  return undefined;
}

const DELETE_ENDPOINT: Record<ObjectCategory, string> = {
  timeline_entry: "timeline-entries.delete",
  link: "links.delete",
  work: "works.delete",
  article: "articles.delete",
  vista: "vistas.delete",
  tag: "tags.delete",
  custom_stage: "stages.custom.delete",
  group: "groups.delete",
  rev_user: "rev-users.delete",
  rev_org: "rev-orgs.delete",
  account: "accounts.delete",
  part: "parts.delete",
};

// Deletion order — dependents first, parents last.
// Tags, stages, and groups are independent of the work/article hierarchy,
// so they're deleted after works but before accounts/parts.
const CATEGORY_ORDER: ObjectCategory[] = [
  "timeline_entry",
  "link",
  "work",
  "article",
  "vista",
  "tag",
  "custom_stage",
  "group",
  "rev_user",
  "rev_org",
  "account",
  "part",
];

// Within parts, delete leaf-first: enhancement → feature → capability → product
const PART_TYPE_ORDER = ["enhancement", "feature", "capability", "product"];

function partTypeRank(id: string): number {
  for (let i = 0; i < PART_TYPE_ORDER.length; i++) {
    if (id.includes(`${PART_TYPE_ORDER[i]}/`)) return i;
  }
  return PART_TYPE_ORDER.length; // unknown → last
}

// ---------------------------------------------------------------------------
// Sorting refs into deletion order
// ---------------------------------------------------------------------------

type RefEntry = { ref: string; entry: ManifestEntry; category: ObjectCategory };

function sortForDeletion(entries: RefEntry[]): RefEntry[] {
  const orderMap = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return entries.sort((a, b) => {
    const catA = orderMap.get(a.category) ?? 999;
    const catB = orderMap.get(b.category) ?? 999;
    if (catA !== catB) return catA - catB;
    // Within parts, leaf types first.
    if (a.category === "part" && b.category === "part") {
      return partTypeRank(a.entry.id) - partTypeRank(b.entry.id);
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Main cleanup logic
// ---------------------------------------------------------------------------

/** Human-friendly display names for category types. */
const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  timeline_entry: "Timeline entries",
  link: "Links",
  work: "Works",
  article: "Articles",
  vista: "Vistas",
  tag: "Tags",
  custom_stage: "Custom stages",
  group: "Groups",
  rev_user: "Rev users",
  rev_org: "Rev orgs",
  account: "Accounts",
  part: "Parts",
};

export type CategoryCounts = { deleted: number; failed: number; skipped: number };

export type CleanupSummary = {
  deleted: number;
  failed: number;
  skipped: number;
  failures: { ref: string; id: string; message: string }[];
  by_category: Partial<Record<ObjectCategory, CategoryCounts>>;
};

export async function cleanupCommand(args: CleanupCliArgs): Promise<void> {
  loadEnvFiles();
  const outputDir = args.outputDir ?? DEFAULT_OUTPUT_DIR;

  // Load the manifest from the most recent apply.
  const manifest = await loadManifest(outputDir);
  const refCount = Object.keys(manifest.refs).length;
  if (refCount === 0) {
    const msg = `No objects to clean up — manifest at ${outputDir} is empty.`;
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ deleted: 0, failed: 0, skipped: 0, failures: [], message: msg })}\n`,
      );
    } else {
      console.log(msg);
    }
    return;
  }

  // Build the sorted deletion list.
  const allRefs: RefEntry[] = [];
  for (const [ref, entry] of Object.entries(manifest.refs)) {
    const cat = categorize(entry.id);
    if (!cat) continue; // Unrecognized DON shape — skip.
    if (args.keepParts && cat === "part") continue;
    allRefs.push({ ref, entry, category: cat });
  }
  const sorted = sortForDeletion(allRefs);

  if (!args.dryRun) {
    const pat = requireEnv("DEVREV_PAT");
    const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
    const client = new DevRevHttpClient({ pat, betaScope: beta });
    const audit = new AuditLogger(outputDir);
    await audit.init();

    if (!args.json) {
      const orgId = await resolveOrgIdentity(client);
      console.log(`\n  Org: ${formatOrgBanner(orgId)}\n`);
    }

    const summary = await executeCleanup(sorted, client, manifest, audit, outputDir, { pat, betaScope: beta });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    } else {
      console.log(
        `\nDone: ${summary.deleted} deleted, ${summary.failed} failed, ${summary.skipped} skipped.`,
      );
      // Per-category breakdown (only show categories that had activity).
      const cats = Object.entries(summary.by_category) as [ObjectCategory, CategoryCounts][];
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
          console.error(`- ${f.ref} (${f.id}): ${f.message}`);
        }
      }
    }
    if (summary.failures.length) process.exitCode = 1;
  } else {
    // Dry-run — just print what would be deleted.
    console.log(`\nDry run — would delete ${sorted.length} object(s):\n`);
    for (const { ref, entry, category } of sorted) {
      console.log(
        `  ${DELETE_ENDPOINT[category]}  ${entry.display_id ?? entry.id}  (ref: ${ref})`,
      );
    }
    console.log(
      `\n${Object.keys(manifest.refs).length - sorted.length} ref(s) skipped (${args.keepParts ? "--keep-parts" : "uncategorized"}).`,
    );
  }
}

async function executeCleanup(
  sorted: RefEntry[],
  client: DevRevHttpClient,
  manifest: RunManifest,
  audit: AuditLogger,
  outputDir: string,
  opts: { pat: string; betaScope: boolean },
): Promise<CleanupSummary> {
  const summary: CleanupSummary = { deleted: 0, failed: 0, skipped: 0, failures: [], by_category: {} };

  const bumpCategory = (cat: ObjectCategory, field: "deleted" | "failed" | "skipped") => {
    if (!summary.by_category[cat]) summary.by_category[cat] = { deleted: 0, failed: 0, skipped: 0 };
    summary.by_category[cat]![field]++;
  };

  // groups.delete is only available on the internal gateway, not the public API.
  const internalClient = new DevRevHttpClient({
    pat: opts.pat,
    baseUrl: "https://app.devrev.ai/api/gateway/internal",
    betaScope: opts.betaScope,
  });

  // Categories where no delete endpoint exists on any API surface.
  const NO_DELETE_API = new Set<ObjectCategory>(["custom_stage"]);

  for (const { ref, entry, category } of sorted) {
    const endpoint = DELETE_ENDPOINT[category];
    const label = entry.display_id ?? entry.id;

    // Custom stages cannot be deleted via any API — skip gracefully.
    if (NO_DELETE_API.has(category)) {
      summary.skipped++;
      bumpCategory(category, "skipped");
      delete manifest.refs[ref];
      console.log(`  ~ ${endpoint}  ${label}  (no delete API — skipped)`);
      await audit.log({
        ts: new Date().toISOString(),
        step_id: `cleanup-${ref}`,
        phase: "execute",
        operation: endpoint,
        status: "skipped",
        rationale: `${category} objects cannot be deleted via API`,
      } as AuditEntry);
      continue;
    }

    try {
      // groups.delete only exists on the internal gateway endpoint.
      const deleteClient = category === "group" ? internalClient : client;
      await deleteClient.post(endpoint, { id: entry.id });
      summary.deleted++;
      bumpCategory(category, "deleted");

      // Remove from manifest so re-running cleanup is idempotent.
      delete manifest.refs[ref];

      await audit.log({
        ts: new Date().toISOString(),
        step_id: `cleanup-${ref}`,
        phase: "execute",
        operation: endpoint,
        status: "ok",
        request: { id: entry.id },
        response_summary: { deleted: label },
      } as AuditEntry);

      console.log(`  ✓ ${endpoint}  ${label}`);
    } catch (err) {
      const msg = err instanceof DevRevHttpError
        ? `${endpoint} HTTP ${err.status}: ${err.bodyText}`
        : err instanceof Error
          ? err.message
          : String(err);

      // If it's a 404 / "not found", treat as already deleted — remove from manifest.
      const is404 =
        (err instanceof DevRevHttpError && err.status === 404) ||
        (err instanceof DevRevHttpError && err.bodyText.includes("not_found"));
      if (is404) {
        summary.skipped++;
        bumpCategory(category, "skipped");
        delete manifest.refs[ref];
        console.log(`  ~ ${endpoint}  ${label}  (already gone)`);
        await audit.log({
          ts: new Date().toISOString(),
          step_id: `cleanup-${ref}`,
          phase: "execute",
          operation: endpoint,
          status: "skipped",
          rationale: "Object already deleted or not found",
        } as AuditEntry);
      } else {
        summary.failed++;
        bumpCategory(category, "failed");
        summary.failures.push({ ref, id: entry.id, message: msg });
        console.error(`  ✗ ${endpoint}  ${label}  → ${msg}`);
        await audit.log({
          ts: new Date().toISOString(),
          step_id: `cleanup-${ref}`,
          phase: "execute",
          operation: endpoint,
          status: "failed",
          error: msg,
          request: { id: entry.id },
        } as AuditEntry);
      }
    }
  }

  // Persist the updated manifest (deleted refs removed).
  await saveManifest(outputDir, manifest);

  return summary;
}
