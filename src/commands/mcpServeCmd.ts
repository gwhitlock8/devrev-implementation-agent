import { runDevRevMcpServer } from "../mcp/server.js";

/**
 * Speak MCP over stdio. Anything the tool prints to stdout is interpreted as
 * MCP protocol — keep this command silent on stdout. Errors go to stderr.
 */
export async function mcpServeCommand(): Promise<void> {
  await runDevRevMcpServer();
}
