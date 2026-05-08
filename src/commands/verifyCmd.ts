import { loadEnvFiles, requireEnv } from "../config/loadEnv.js";
import { loadManifest } from "../executor/manifest.js";
import { DevRevMcpClient, extractText } from "../mcp/devrevClient.js";
import { DEFAULT_OUTPUT_DIR } from "./planCmd.js";

export type VerifyCliArgs = {
  outputDir?: string;
};

type CheckResult = {
  ref: string;
  id: string;
  display_id?: string;
  status: "ok" | "missing" | "error";
  detail?: string;
};

export async function verifyCommand(args: VerifyCliArgs): Promise<void> {
  loadEnvFiles();
  requireEnv("DEVREV_PAT");
  const outputDir = args.outputDir ?? DEFAULT_OUTPUT_DIR;
  const manifest = await loadManifest(outputDir);
  const refs = Object.keys(manifest.refs);
  if (refs.length === 0) {
    console.log(`No manifest entries in ${outputDir}/run-manifest.json — nothing to verify.`);
    return;
  }

  const mcp = new DevRevMcpClient();
  try {
    await mcp.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not connect to DevRev MCP: ${msg}\n` +
        "Default is `dia mcp-serve` — make sure `dia` is on your PATH. " +
        "Or set DEVREV_MCP_COMMAND / DEVREV_MCP_ARGS to use a different MCP server.",
    );
  }

  const results: CheckResult[] = [];
  try {
    for (const ref of refs) {
      const entry = manifest.refs[ref];
      const lookupId = entry.display_id ?? entry.id;
      try {
        const r = await mcp.getObject(lookupId);
        if (!r) {
          results.push({
            ref,
            id: entry.id,
            display_id: entry.display_id,
            status: "error",
            detail: "DevRev MCP exposes no get_object-style tool",
          });
          continue;
        }
        if (r.isError) {
          results.push({
            ref,
            id: entry.id,
            display_id: entry.display_id,
            status: "missing",
            detail: extractText(r).slice(0, 300),
          });
        } else {
          results.push({ ref, id: entry.id, display_id: entry.display_id, status: "ok" });
        }
      } catch (e) {
        results.push({
          ref,
          id: entry.id,
          display_id: entry.display_id,
          status: "error",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await mcp.close();
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const missing = results.filter((r) => r.status === "missing");
  const errored = results.filter((r) => r.status === "error");
  console.log(`\nVerify summary: ${ok}/${results.length} present in DevRev`);
  if (missing.length) {
    console.log("\nMissing:");
    for (const m of missing) {
      console.log(`  - ${m.ref} (${m.display_id ?? m.id})${m.detail ? ` — ${m.detail}` : ""}`);
    }
  }
  if (errored.length) {
    console.log("\nErrors:");
    for (const e of errored) {
      console.log(`  - ${e.ref}: ${e.detail ?? "unknown"}`);
    }
  }
  if (missing.length || errored.length) process.exitCode = 1;
}
