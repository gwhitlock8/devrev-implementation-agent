import Anthropic from "@anthropic-ai/sdk";
import { BlueprintSchema, type Blueprint } from "../parsers/blueprint.js";
import { BLUEPRINT_SYNTHESIZER_SYSTEM } from "./prompts.js";
import { DevRevMcpClient, extractText } from "../mcp/devrevClient.js";

const SUBMIT_BLUEPRINT_TOOL = {
  name: "submit_blueprint",
  description:
    "Submit the final DevRev POC blueprint. Call exactly once. The blueprint is then turned into a deterministic plan and shown to the user for confirmation.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      defaults: { type: "object" },
      parts: { type: "array" },
      works: { type: "array" },
      incidents: { type: "array" },
      accounts: { type: "array" },
      rev_users: { type: "array" },
      links: { type: "array" },
      csv: { type: "array" },
      ui_guidance: { type: "array" },
    },
  },
} as const;

const LOOKUP_ORG_TOOL = {
  name: "lookup_org",
  description:
    "Search the live DevRev org for existing objects by name. Returns matches across the requested types. Use this sparingly (3–4 calls max) to avoid recreating objects that already exist. Pass `types` to narrow the search — e.g. `[\"part\"]` when checking for an existing product so you don't waste budget fetching every account/work/rev_user.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search, e.g. 'Acme' or 'Lumio'.",
      },
      types: {
        type: "array",
        description: "Object kinds to search. Defaults to all six.",
        items: {
          type: "string",
          enum: ["account", "part", "work", "rev_user", "incident", "article"],
        },
      },
    },
    required: ["query"],
  },
} as const;

export const DEFAULT_ANTHROPIC_PLANNER_MODEL = "claude-sonnet-4-6";

export type PlannerEvent =
  | { kind: "turn_start"; turn: number }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; name: string; ok: boolean; preview?: string }
  | { kind: "blueprint_received"; valid: boolean }
  | { kind: "blueprint_invalid_retrying"; issues: { path: string; message: string }[] };

export type SynthesizeBlueprintParams = {
  userPrompt: string;
  apiKey: string;
  model?: string;
  /** When provided, exposes a `lookup_org` tool to the planner. */
  mcp?: DevRevMcpClient | null;
  /** Hard ceiling on agentic turns. */
  maxTurns?: number;
  /** Optional progress hook — fires on every meaningful state change. */
  onEvent?: (event: PlannerEvent) => void;
};

export async function synthesizeBlueprintWithClaude(
  params: SynthesizeBlueprintParams,
): Promise<Blueprint> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const model = params.model ?? DEFAULT_ANTHROPIC_PLANNER_MODEL;
  const maxTurns = params.maxTurns ?? 12;
  const useMcp = Boolean(params.mcp);

  const tools: Anthropic.Tool[] = [SUBMIT_BLUEPRINT_TOOL as unknown as Anthropic.Tool];
  if (useMcp) tools.push(LOOKUP_ORG_TOOL as unknown as Anthropic.Tool);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        "Brief from the sales engineer:",
        params.userPrompt.trim() || "(none provided — produce a small, balanced demo blueprint)",
      ].join("\n"),
    },
  ];

  const emit = params.onEvent ?? (() => {});

  for (let turn = 0; turn < maxTurns; turn++) {
    emit({ kind: "turn_start", turn: turn + 1 });
    let resp: Anthropic.Message;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: 8192,
        system: BLUEPRINT_SYNTHESIZER_SYSTEM,
        tools,
        messages,
      });
    } catch (e) {
      const status =
        typeof e === "object" && e !== null && "status" in e
          ? Number((e as { status: number }).status)
          : undefined;
      const body =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: string }).message)
          : String(e);
      if (status === 404 || body.includes("not_found_error") || body.includes("not_found")) {
        throw new Error(
          `Anthropic returned 404 for model "${model}" (often means the model id was retired). ` +
            `Set ANTHROPIC_MODEL to a model your API key can access. ` +
            `List models: curl -sS https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" | head -c 2000\n` +
            `Original error: ${body}`,
        );
      }
      throw e;
    }

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");

    if (resp.stop_reason === "end_turn" && toolUses.length === 0) {
      const hint = textBlocks.map((b) => b.text).join("\n");
      throw new Error(
        `Planner stopped without submit_blueprint. Model output:\n${hint.slice(0, 2000)}`,
      );
    }

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      emit({ kind: "tool_use", name: tu.name, input: tu.input });
      if (tu.name === "submit_blueprint") {
        const parsed = BlueprintSchema.safeParse(tu.input);
        if (parsed.success) {
          emit({ kind: "blueprint_received", valid: true });
          return parsed.data;
        }
        emit({ kind: "blueprint_received", valid: false });
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.length ? i.path.join(".") : "(root)",
          message: i.message,
        }));
        emit({ kind: "blueprint_invalid_retrying", issues });
        const issuesText = issues.map((i) => `- ${i.path}: ${i.message}`).join("\n");
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: [
            {
              type: "text",
              text: `submit_blueprint payload failed schema validation:\n${issuesText}\nRevise and call submit_blueprint again.`,
            },
          ],
        });
        continue;
      }
      if (tu.name === "lookup_org" && params.mcp) {
        const input = tu.input as { query?: string; types?: string[] };
        const query = input.query ?? "";
        const types = Array.isArray(input.types) ? input.types : undefined;
        try {
          const r = await params.mcp.search(query, types);
          const text = extractText(r) || "(no results)";
          emit({ kind: "tool_result", name: tu.name, ok: true, preview: text.slice(0, 120) });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: [{ type: "text", text: text.slice(0, 6000) }],
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          emit({ kind: "tool_result", name: tu.name, ok: false, preview: msg.slice(0, 120) });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: [{ type: "text", text: `lookup_org failed: ${msg}` }],
          });
        }
        continue;
      }
      emit({ kind: "tool_result", name: tu.name, ok: false, preview: "unknown tool" });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: true,
        content: [{ type: "text", text: `unknown tool: ${tu.name}` }],
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error("Planner exceeded max turns without submit_blueprint");
}
