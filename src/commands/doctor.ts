import { DevRevHttpClient } from "../api/client.js";
import { devUsersGet, devUsersSelf, devOrgsGet, resolveOrgIdentity, formatOrgBanner, type DevUserRecord } from "../api/devUsers.js";
import { ReadOnlyDevRevClient } from "../api/readOnlyClient.js";
import { loadEnvFiles, optionalEnv, requireEnv } from "../config/loadEnv.js";
import { DevRevMcpClient } from "../mcp/devrevClient.js";

function describeRole(u: DevUserRecord | undefined): string {
  if (!u) return "Role: (no user)";
  if (typeof u.role === "string" && u.role) return `Role: ${u.role}`;
  if (typeof u.permission_set === "string" && u.permission_set) {
    return `Permission set: ${u.permission_set}`;
  }
  if (u.permission_set && typeof u.permission_set === "object") {
    const ps = u.permission_set;
    const label = ps.name || ps.id;
    if (label) return `Permission set: ${label}`;
  }
  if (typeof u.user_type === "string" && u.user_type) return `User type: ${u.user_type}`;
  // DevRev's REST `dev-users.self` and `dev-users.get` don't return a role
  // field today (verified 2026-05-08). Fall back to `state` (always present)
  // and tell the SE where to verify Admin before running setup steps.
  const state = typeof u.state === "string" && u.state ? u.state : "unknown";
  return `User state: ${state} (REST does not expose role; verify Admin in the DevRev UI before running integration / SLA setup)`;
}

export async function doctorCommand(): Promise<void> {
  loadEnvFiles();
  let exitCode = 0;

  // 1. DevRev PAT via REST
  try {
    const pat = requireEnv("DEVREV_PAT");
    const beta = process.env.DEVREV_BETA === "1" || process.env.DEVREV_BETA === "true";
    const client = new DevRevHttpClient({ pat, betaScope: beta });
    const [self, orgRes] = await Promise.all([
      devUsersSelf(client),
      devOrgsGet(client).catch(() => ({ dev_org: undefined })),
    ]);
    const u = self.dev_user;
    const org = orgRes.dev_org;
    console.log("✓ DevRev PAT is valid (REST API).");
    if (org) {
      console.log(`  Org: ${org.display_name ?? org.dev_slug ?? "?"} (${org.display_id ?? "?"})`);
    }
    console.log(`  User: ${u?.full_name ?? u?.display_handle ?? "?"} (${u?.email ?? "no email"})`);
    console.log(`  display_id: ${u?.display_id ?? "?"}  id: ${u?.id ?? "?"}`);
    // Best-effort role surface: dev-users.self may not include role; fall
    // back to dev-users.get for the same id and try again. Never fail the
    // doctor on this — informational only.
    let userRecord = u;
    if (u?.id && !describeRole(u).startsWith("Role:") && !describeRole(u).startsWith("Permission")) {
      try {
        const fetched = await devUsersGet(client, u.id);
        if (fetched.dev_user) userRecord = fetched.dev_user;
      } catch {
        /* swallow — informational */
      }
    }
    const roleDesc = describeRole(userRecord);
    console.log(`  ${roleDesc}`);
    if (!roleDesc.startsWith("Role: admin") && !roleDesc.startsWith("Role: Admin")) {
      console.log(
        "  ⚠ Could not confirm Admin role. Integration installs, SLA configuration, and some Settings menus require Admin. " +
        "Verify your role in DevRev UI → Settings → Members before running `dia apply` on blueprints with integrations or SLA policies.",
      );
    }
  } catch (e) {
    console.error(`✗ DevRev REST check failed: ${e instanceof Error ? e.message : String(e)}`);
    exitCode = 1;
  }

  // 2. Research PAT — used by `dia research` (read-only against internal org).
  const researchPat = optionalEnv("DEVREV_RESEARCH_PAT");
  if (researchPat) {
    try {
      const researchClient = new ReadOnlyDevRevClient({ pat: researchPat });
      const researchId = await resolveOrgIdentity(researchClient);
      console.log(`✓ DEVREV_RESEARCH_PAT is valid (read-only).`);
      console.log(`  Research org: ${formatOrgBanner(researchId)}`);
    } catch (e) {
      console.error(`✗ DEVREV_RESEARCH_PAT check failed: ${e instanceof Error ? e.message : String(e)}`);
      exitCode = 1;
    }
  } else {
    console.log("- DEVREV_RESEARCH_PAT not set (only needed for `dia research`).");
  }

  // 3. Anthropic key (existence only — don't burn a request).
  if (optionalEnv("ANTHROPIC_API_KEY")) {
    console.log("✓ ANTHROPIC_API_KEY present.");
  } else {
    console.log("- ANTHROPIC_API_KEY not set (only needed for `plan` / `start` from a NL brief).");
  }

  // 4. DevRev MCP — defaults to `dia mcp-serve` (the in-repo server).
  const customCommand = optionalEnv("DEVREV_MCP_COMMAND");
  const mcp = new DevRevMcpClient();
  try {
    await mcp.connect();
    const tools = await mcp.listTools();
    const label = customCommand ? `via DEVREV_MCP_COMMAND=${customCommand}` : "via built-in `dia mcp-serve`";
    console.log(`✓ DevRev MCP connected ${label}. ${tools.length} tools available.`);
    const sample = tools.slice(0, 8).map((t) => t.name).join(", ");
    if (tools.length) console.log(`  e.g. ${sample}${tools.length > 8 ? ", …" : ""}`);
    if (!tools.some((t) => /search/i.test(t.name))) {
      console.log("  ⚠ no search-style tool detected; `lookup_org` and `verify` may be limited.");
    }
  } catch (e) {
    console.error(
      `✗ DevRev MCP connection failed: ${e instanceof Error ? e.message : String(e)}\n` +
        "  If using the built-in server, make sure `dia` is on your PATH (`npm link` from the project).\n" +
        "  Or set DEVREV_MCP_COMMAND / DEVREV_MCP_ARGS to point at a different MCP server.",
    );
    exitCode = 1;
  } finally {
    await mcp.close();
  }

  if (exitCode) process.exitCode = exitCode;
}
