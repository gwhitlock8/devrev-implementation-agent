import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunManifest } from "../executor/manifest.js";

// We test the internal logic by importing cleanupCommand and mocking the
// DevRev API + env. The command reads a real manifest from disk.

describe("dia cleanup", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dia-cleanup-"));
  });

  /** Write a manifest file and return the path. */
  async function writeManifest(manifest: RunManifest) {
    await writeFile(join(tempDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
  }

  /** Read the manifest back after cleanup. */
  async function readManifest(): Promise<RunManifest> {
    const raw = await readFile(join(tempDir, "run-manifest.json"), "utf8");
    return JSON.parse(raw);
  }

  it("sorts deletions in correct dependency order", async () => {
    // Import the module to test sorting logic
    // We'll test by examining the DON category inference + sort order indirectly
    // by checking the output order from a dry-run.

    const manifest: RunManifest = {
      refs: {
        "prod:lumio": { id: "don:core:dvrv-us-1:devo/0:product/1", display_id: "PROD-1" },
        "cap:auth": { id: "don:core:dvrv-us-1:devo/0:capability/2", display_id: "CAPL-2" },
        "feat:sso": { id: "don:core:dvrv-us-1:devo/0:feature/3", display_id: "FEAT-3" },
        "tic:sso-fail": { id: "don:core:dvrv-us-1:devo/0:ticket/4", display_id: "TKT-4" },
        "art:sso-guide": { id: "don:core:dvrv-us-1:devo/0:article/5", display_id: "ART-5" },
        "acc:acme": { id: "don:core:dvrv-us-1:devo/0:account/6", display_id: "ACC-6" },
      },
      completed: {},
    };
    await writeManifest(manifest);

    // Capture console output from dry-run
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));

    // Dynamic import to avoid env issues
    const { cleanupCommand } = await import("./cleanupCmd.js");
    await cleanupCommand({ outputDir: tempDir, dryRun: true, keepParts: false });

    console.log = origLog;

    // Extract the endpoint order from the dry-run output lines
    const endpointLines = lines.filter((l) => l.includes(".delete"));
    const endpoints = endpointLines.map((l) => l.trim().split(/\s+/)[0]);

    // Works (tickets) should come before articles, articles before accounts, accounts before parts
    const worksIdx = endpoints.indexOf("works.delete");
    const articlesIdx = endpoints.indexOf("articles.delete");
    const accountsIdx = endpoints.indexOf("accounts.delete");
    const firstPartIdx = endpoints.findIndex((e) => e === "parts.delete");

    expect(worksIdx).toBeLessThan(articlesIdx);
    expect(articlesIdx).toBeLessThan(accountsIdx);
    expect(accountsIdx).toBeLessThan(firstPartIdx);

    // Parts should be leaf-first: feature → capability → product
    const partLines = endpointLines.filter((l) => l.includes("parts.delete"));
    const partIds = partLines.map((l) => {
      const match = l.match(/(FEAT|CAPL|PROD)-\d+/);
      return match?.[0] ?? "";
    });
    expect(partIds).toEqual(["FEAT-3", "CAPL-2", "PROD-1"]);
  });

  it("--keep-parts excludes all parts from deletion", async () => {
    const manifest: RunManifest = {
      refs: {
        "prod:lumio": { id: "don:core:dvrv-us-1:devo/0:product/1", display_id: "PROD-1" },
        "cap:auth": { id: "don:core:dvrv-us-1:devo/0:capability/2", display_id: "CAPL-2" },
        "tic:sso-fail": { id: "don:core:dvrv-us-1:devo/0:ticket/4", display_id: "TKT-4" },
      },
      completed: {},
    };
    await writeManifest(manifest);

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));

    const { cleanupCommand } = await import("./cleanupCmd.js");
    await cleanupCommand({ outputDir: tempDir, dryRun: true, keepParts: true });

    console.log = origLog;

    const endpointLines = lines.filter((l) => l.includes(".delete"));
    // Only the ticket should appear — no parts
    expect(endpointLines).toHaveLength(1);
    expect(endpointLines[0]).toContain("works.delete");
    expect(endpointLines[0]).toContain("TKT-4");
  });

  it("empty manifest produces a no-op message", async () => {
    await writeManifest({ refs: {}, completed: {} });

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));

    const { cleanupCommand } = await import("./cleanupCmd.js");
    await cleanupCommand({ outputDir: tempDir, dryRun: true, keepParts: false });

    console.log = origLog;
    expect(lines.some((l) => l.includes("empty"))).toBe(true);
  });

  it("categorizes all common DON ID shapes correctly", async () => {
    // Test a broad range of DON patterns
    const manifest: RunManifest = {
      refs: {
        "a": { id: "don:core:dvrv-us-1:devo/0:ticket/1" },
        "b": { id: "don:core:dvrv-us-1:devo/0:issue/2" },
        "c": { id: "don:core:dvrv-us-1:devo/0:task/3" },
        "d": { id: "don:core:dvrv-us-1:devo/0:opportunity/4" },
        "e": { id: "don:core:dvrv-us-1:devo/0:product/5" },
        "f": { id: "don:core:dvrv-us-1:devo/0:capability/6" },
        "g": { id: "don:core:dvrv-us-1:devo/0:feature/7" },
        "h": { id: "don:core:dvrv-us-1:devo/0:enhancement/8" },
        "i": { id: "don:core:dvrv-us-1:devo/0:article/9" },
        "j": { id: "don:core:dvrv-us-1:devo/0:account/10" },
        "k": { id: "don:core:dvrv-us-1:devo/0:rev_user/11" },
        "l": { id: "don:core:dvrv-us-1:devo/0:rev_org/12" },
      },
      completed: {},
    };
    await writeManifest(manifest);

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));

    const { cleanupCommand } = await import("./cleanupCmd.js");
    await cleanupCommand({ outputDir: tempDir, dryRun: true, keepParts: false });

    console.log = origLog;

    const endpointLines = lines.filter((l) => l.includes(".delete"));
    // All 12 refs should be categorized — none skipped
    expect(endpointLines).toHaveLength(12);

    // Verify the correct endpoints appear
    const endpointSet = new Set(endpointLines.map((l) => l.trim().split(/\s+/)[0]));
    expect(endpointSet).toContain("works.delete");
    expect(endpointSet).toContain("parts.delete");
    expect(endpointSet).toContain("articles.delete");
    expect(endpointSet).toContain("accounts.delete");
    expect(endpointSet).toContain("rev-users.delete");
    expect(endpointSet).toContain("rev-orgs.delete");
  });
});
