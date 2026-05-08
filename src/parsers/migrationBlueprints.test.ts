import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlanFromBlueprint } from "../plan/buildFromBlueprint.js";
import { loadBlueprintFile } from "./blueprint.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "migration-bp-"));
}

const ROOT = new URL("../../blueprints/", import.meta.url).pathname;

describe("migration blueprints", () => {
  it("freshdesk-migration.json loads and builds with no ref issues", async () => {
    const dir = await tempDir();
    const bp = await loadBlueprintFile(join(ROOT, "freshdesk-migration.json"));
    const result = await buildPlanFromBlueprint(bp, { outputDir: dir });
    expect(result.refIssues).toEqual([]);
    expect(result.plan.steps.length).toBeGreaterThan(20);
    // Should include articles (KB) and timeline entries (auto-conversations).
    const kinds = new Set(result.plan.steps.map((s) => s.kind));
    expect(kinds.has("create_part")).toBe(true);
    expect(kinds.has("create_article")).toBe(true);
    expect(kinds.has("create_work")).toBe(true);
    expect(kinds.has("create_timeline_entry")).toBe(true);
  });

  it("zendesk-migration.json loads and builds with no ref issues", async () => {
    const dir = await tempDir();
    const bp = await loadBlueprintFile(join(ROOT, "zendesk-migration.json"));
    const result = await buildPlanFromBlueprint(bp, { outputDir: dir });
    expect(result.refIssues).toEqual([]);
    expect(result.plan.steps.length).toBeGreaterThan(20);
    const kinds = new Set(result.plan.steps.map((s) => s.kind));
    expect(kinds.has("create_article")).toBe(true);
    expect(kinds.has("create_timeline_entry")).toBe(true);
  });
});
