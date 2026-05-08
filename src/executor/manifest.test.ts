import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyManifest, loadManifest, saveManifest } from "./manifest.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "manifest-test-"));
}

describe("RunManifest", () => {
  it("loads a fresh manifest as { refs: {}, completed: {} }", async () => {
    const dir = await tempDir();
    const m = await loadManifest(dir);
    expect(m).toEqual(emptyManifest());
  });

  it("round-trips refs and completed", async () => {
    const dir = await tempDir();
    const m = emptyManifest();
    m.refs["prod:p"] = { id: "don:p1", display_id: "PROD-1" };
    m.completed["part-1"] = true;
    await saveManifest(dir, m);
    const back = await loadManifest(dir);
    expect(back.refs["prod:p"]).toEqual({ id: "don:p1", display_id: "PROD-1" });
    expect(back.completed["part-1"]).toBe(true);
  });

  it("upgrades a legacy flat manifest in place", async () => {
    const dir = await tempDir();
    // Pre-Phase-B layout: just Record<ref, ManifestEntry>.
    const legacy = {
      "prod:p": { id: "don:p1", display_id: "PROD-1" },
      "feat:a": { id: "don:f1", display_id: "FEAT-1" },
    };
    await writeFile(join(dir, "run-manifest.json"), JSON.stringify(legacy), "utf8");
    const m = await loadManifest(dir);
    expect(m.refs["prod:p"].display_id).toBe("PROD-1");
    expect(m.refs["feat:a"].display_id).toBe("FEAT-1");
    expect(m.completed).toEqual({});
  });
});
