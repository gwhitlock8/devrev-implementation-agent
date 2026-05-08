import type { Blueprint } from "../parsers/blueprint.js";
import type { DevRevMcpClient } from "../mcp/devrevClient.js";
import { extractText } from "../mcp/devrevClient.js";

export type PreflightWarning = { path: string; message: string };

/**
 * Pre-flight check: query the live org via MCP for parts whose names
 * collide with blueprint parts. DevRev allows duplicate part names but
 * they cause confusion in dropdowns (Slack snap-in routing, sprint board
 * creation, etc.). Surface as a non-fatal warning so SEs can rename.
 *
 * Silent no-op when MCP isn't connected — preserves the "MCP is optional"
 * guarantee from earlier phases.
 */
export async function detectDuplicatePartNames(
  blueprint: Blueprint,
  mcp: DevRevMcpClient | null | undefined,
): Promise<PreflightWarning[]> {
  if (!mcp) return [];
  const warnings: PreflightWarning[] = [];
  const parts = blueprint.parts ?? [];
  if (parts.length === 0) return [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.name) continue;
    let result;
    try {
      result = await mcp.search(p.name, ["part"]);
    } catch {
      // MCP transport hiccup — don't fail the plan over a soft check.
      continue;
    }
    if (!result || result.isError) continue;
    const text = extractText(result);
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // The MCP `search` tool returns "(no matches)" on misses; skip if
      // we can't parse a hits array out.
      continue;
    }
    const hits = extractHits(parsed);
    const collision = hits.find(
      (h) => typeof h.name === "string" && h.name.toLowerCase() === p.name.toLowerCase(),
    );
    if (collision) {
      warnings.push({
        path: `parts[${i}].name`,
        message: `a part named "${p.name}" already exists in the org (display_id ${collision.display_id ?? collision.id ?? "unknown"}). DevRev allows duplicates but they're confusing in routing dropdowns — rename or reuse the existing part.`,
      });
    }
  }
  return warnings;
}

type SearchHit = { name?: unknown; id?: unknown; display_id?: unknown };

function extractHits(parsed: unknown): SearchHit[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as { hits?: unknown };
  if (!Array.isArray(obj.hits)) return [];
  return obj.hits as SearchHit[];
}
