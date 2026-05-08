import { describe, expect, it } from "vitest";
import type { CallToolResult, DevRevMcpClient } from "../mcp/devrevClient.js";
import { detectDuplicatePartNames } from "./preflight.js";

/**
 * Minimal MCP client stub shaped like `DevRevMcpClient` for the duplicate-name
 * preflight. We only exercise `search` here; the real client is full of
 * subprocess + transport machinery we don't want to drag into a unit test.
 */
function stubMcp(
  hits: Record<string, Array<{ name: string; display_id?: string }>>,
): DevRevMcpClient {
  return {
    async search(query: string): Promise<CallToolResult | null> {
      const matches = hits[query] ?? [];
      if (matches.length === 0) {
        return { content: [{ type: "text", text: "(no matches)" }] };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: matches.length,
              hits: matches.map((m) => ({ type: "part", name: m.name, display_id: m.display_id })),
            }),
          },
        ],
      };
    },
  } as unknown as DevRevMcpClient;
}

describe("detectDuplicatePartNames", () => {
  it("returns [] when MCP is null (silent skip)", async () => {
    const w = await detectDuplicatePartNames(
      { parts: [{ ref: "prod:p", type: "product", name: "Foo" }] },
      null,
    );
    expect(w).toEqual([]);
  });

  it("returns [] when blueprint has no parts", async () => {
    const w = await detectDuplicatePartNames({}, stubMcp({}));
    expect(w).toEqual([]);
  });

  it("flags a part whose name already exists in the org (case-insensitive)", async () => {
    const w = await detectDuplicatePartNames(
      {
        parts: [
          { ref: "prod:lumio", type: "product", name: "Lumio" },
          { ref: "prod:fresh", type: "product", name: "FreshThing" },
        ],
      },
      stubMcp({
        Lumio: [{ name: "lumio", display_id: "PROD-7" }],
        FreshThing: [],
      }),
    );
    expect(w.length).toBe(1);
    expect(w[0].path).toBe("parts[0].name");
    expect(w[0].message).toContain('"Lumio"');
    expect(w[0].message).toContain("PROD-7");
  });

  it("does not flag substring or prefix matches — only exact (case-insensitive) name equality", async () => {
    const w = await detectDuplicatePartNames(
      { parts: [{ ref: "prod:lumio", type: "product", name: "Lumio" }] },
      stubMcp({
        Lumio: [
          { name: "Lumio Prime", display_id: "PROD-1" },
          { name: "lumi", display_id: "PROD-2" },
        ],
      }),
    );
    expect(w).toEqual([]);
  });

  it("tolerates an MCP search that throws", async () => {
    const throwingMcp = {
      async search() {
        throw new Error("mcp transport hiccup");
      },
    } as unknown as DevRevMcpClient;
    const w = await detectDuplicatePartNames(
      { parts: [{ ref: "prod:p", type: "product", name: "Foo" }] },
      throwingMcp,
    );
    expect(w).toEqual([]);
  });
});
