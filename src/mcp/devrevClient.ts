import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type DevRevMcpConfig = {
  /** Defaults to env DEVREV_MCP_COMMAND or `npx`. */
  command?: string;
  /** Defaults to env DEVREV_MCP_ARGS (space-separated) or `["-y", "@devrev/mcp"]`. */
  args?: string[];
  /** PAT to forward to the MCP subprocess. Defaults to env DEVREV_PAT. */
  pat?: string;
  /** Extra env to merge in. */
  env?: Record<string, string>;
};

export type ToolDescriptor = {
  name: string;
  description?: string;
};

export type CallToolResult = {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
};

/**
 * Thin client over the DevRev MCP server. The MCP package name and CLI vary
 * across DevRev releases, so the command is configurable via env vars.
 *
 * Lifecycle: `connect()` → `callTool(...)` → `close()`. Always call close().
 */
export class DevRevMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private toolNames = new Set<string>();
  private readonly config: Required<Pick<DevRevMcpConfig, "command" | "args">> & {
    pat?: string;
    env?: Record<string, string>;
  };

  constructor(config: DevRevMcpConfig = {}) {
    // Default: spawn this same CLI as an MCP server. Lets us avoid any external
    // dep — `dia mcp-serve` is built in. Override via env to use a different
    // MCP server (community implementation, official DevRev MCP if/when one
    // exists, etc.).
    const command = config.command ?? process.env.DEVREV_MCP_COMMAND ?? "dia";
    const args =
      config.args ??
      (process.env.DEVREV_MCP_ARGS !== undefined
        ? process.env.DEVREV_MCP_ARGS.split(/\s+/).filter(Boolean)
        : process.env.DEVREV_MCP_COMMAND
          ? []
          : ["mcp-serve"]);
    this.config = {
      command,
      args,
      pat: config.pat ?? process.env.DEVREV_PAT,
      env: config.env,
    };
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const childEnv: Record<string, string> = {
      ...filterStringEnv(process.env),
      ...(this.config.env ?? {}),
    };
    if (this.config.pat) childEnv.DEVREV_PAT = this.config.pat;
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: childEnv,
      stderr: "pipe",
    });
    this.client = new Client({ name: "devrev-impl-agent", version: "0.2.0" });
    await this.client.connect(this.transport);
    const list = await this.client.listTools();
    this.toolNames = new Set(list.tools.map((t) => t.name));
  }

  async listTools(): Promise<ToolDescriptor[]> {
    if (!this.client) await this.connect();
    const list = await this.client!.listTools();
    return list.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  hasTool(name: string): boolean {
    return this.toolNames.has(name);
  }

  /** Call any MCP tool by name. */
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) await this.connect();
    const res = (await this.client!.callTool({ name, arguments: args })) as CallToolResult;
    return res;
  }

  /**
   * Pick the first tool whose name appears in `candidates` and call it.
   * Different DevRev MCP releases expose slightly different tool names
   * (e.g. `search` vs `devrev_search` vs `search_objects`); this papers over that.
   */
  async callFirstAvailable(
    candidates: string[],
    args: Record<string, unknown>,
  ): Promise<{ toolName: string; result: CallToolResult } | null> {
    if (!this.client) await this.connect();
    for (const c of candidates) {
      if (this.toolNames.has(c)) {
        const result = await this.callTool(c, args);
        return { toolName: c, result };
      }
    }
    return null;
  }

  async search(
    query: string,
    types?: string[],
  ): Promise<CallToolResult | null> {
    const args: Record<string, unknown> = { query };
    if (types && types.length) args.types = types;
    const r = await this.callFirstAvailable(
      ["search", "devrev_search", "search_objects"],
      args,
    );
    return r?.result ?? null;
  }

  async getObject(id: string): Promise<CallToolResult | null> {
    const r = await this.callFirstAvailable(
      ["get_object", "devrev_get_object", "object_get"],
      { id },
    );
    return r?.result ?? null;
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
    this.toolNames.clear();
  }
}

function filterStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Best-effort text extraction from a CallToolResult. */
export function extractText(result: CallToolResult | null): string {
  if (!result) return "";
  return result.content
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
}
