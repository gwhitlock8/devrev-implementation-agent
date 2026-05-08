import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DevRevHttpClient } from "../api/client.js";
import { AuditLogger } from "../logging/audit.js";
import type { Plan } from "../types/plan.js";
import { emptyManifest, saveManifest } from "./manifest.js";
import { executePlan } from "./runner.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "runner-test-"));
}

/** A fetch double whose first call (for dev-users.self) returns a fixed self
 *  response, and that records every URL it sees so tests can assert what was
 *  actually called. */
function makeFetch(): {
  fn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.endsWith("dev-users.self")) {
      return new Response(
        JSON.stringify({ dev_user: { id: "don:dev/u/1", display_id: "DEVU-1" } }),
        { status: 200 },
      );
    }
    // Default: 200 ok with empty body for any other call. Tests should fail
    // if they hit this path during a resume-skip scenario.
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("executePlan --resume", () => {
  it("skips steps whose ids are already in manifest.completed", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();

    // Pre-seed the manifest to mark `part-1` as already completed.
    const manifest = emptyManifest();
    manifest.completed["part-1"] = true;
    manifest.refs["prod:p"] = { id: "don:p/1", display_id: "PROD-1" };
    await saveManifest(dir, manifest);

    const { fn, calls } = makeFetch();
    const client = new DevRevHttpClient({ pat: "fake", fetchFn: fn });

    const plan: Plan = {
      version: 1,
      title: "T",
      steps: [
        {
          id: "part-1",
          kind: "create_part",
          title: "Skip me",
          rationale: "prior run created me",
          payload: { manifest_ref: "prod:p", body: { type: "product", name: "P" } },
        },
      ],
    };

    const summary = await executePlan({
      plan,
      client,
      dryRun: false,
      outputDir: dir,
      audit,
      resume: true,
    });

    expect(summary.skipped).toBe(1);
    expect(summary.ok).toBe(0);
    expect(summary.failed).toBe(0);
    // The only DevRev call permitted during a full-skip resume is dev-users.self.
    expect(calls.every((c) => c.endsWith("dev-users.self"))).toBe(true);
  });

  it("fails create_part with a clear message when owned_by is missing or empty", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();

    const fn = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("dev-users.self")) {
        return new Response(
          JSON.stringify({ dev_user: { id: "don:dev/u/1", display_id: "DEVU-1" } }),
          { status: 200 },
        );
      }
      // Should never reach parts.create — guard fires first.
      return new Response(
        JSON.stringify({ message: "Bad Request", type: "invalid_field", field_name: "owned_by" }),
        { status: 400 },
      );
    }) as unknown as typeof fetch;

    const client = new DevRevHttpClient({ pat: "fake", fetchFn: fn });
    const plan: Plan = {
      version: 1,
      title: "T",
      steps: [
        {
          id: "part-bad",
          kind: "create_part",
          title: "Part with no owners",
          rationale: "synthetic test of owned_by guard",
          payload: {
            manifest_ref: "prod:bad",
            body: { type: "product", name: "Bad" }, // owned_by intentionally absent
          },
        },
      ],
    };

    const summary = await executePlan({
      plan,
      client,
      dryRun: false,
      outputDir: dir,
      audit,
    });

    expect(summary.failed).toBe(1);
    expect(summary.failures[0].message).toMatch(/owned_by/);
    expect(summary.failures[0].message).toMatch(/parts\.create/);
  });

  it("marks newly-completed steps in the manifest", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();

    const fn = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("dev-users.self")) {
        return new Response(
          JSON.stringify({ dev_user: { id: "don:dev/u/1", display_id: "DEVU-1" } }),
          { status: 200 },
        );
      }
      if (url.endsWith("parts.create")) {
        return new Response(
          JSON.stringify({ part: { id: "don:p/new", display_id: "PROD-9" } }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = new DevRevHttpClient({ pat: "fake", fetchFn: fn });
    const plan: Plan = {
      version: 1,
      title: "T",
      steps: [
        {
          id: "part-new",
          kind: "create_part",
          title: "New part",
          rationale: "first run",
          payload: {
            manifest_ref: "prod:n",
            body: { type: "product", name: "N", owned_by: ["DEVU-1"] },
          },
        },
      ],
    };

    const summary = await executePlan({
      plan,
      client,
      dryRun: false,
      outputDir: dir,
      audit,
    });

    expect(summary.ok).toBe(1);
    // Re-load manifest from disk: completion marker should be persisted.
    const { loadManifest } = await import("./manifest.js");
    const after = await loadManifest(dir);
    expect(after.completed["part-new"]).toBe(true);
    expect(after.refs["prod:n"]?.display_id).toBe("PROD-9");
  });
});
