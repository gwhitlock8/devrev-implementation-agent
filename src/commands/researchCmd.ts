import Anthropic from "@anthropic-ai/sdk";
import { resolveOrgIdentity, formatOrgBanner } from "../api/devUsers.js";
import { ReadOnlyDevRevClient } from "../api/readOnlyClient.js";
import { loadEnvFiles, requireEnv, optionalEnv } from "../config/loadEnv.js";
import { pickModel } from "../util/modelPicker.js";
import {
  gatherResearchContext,
  formatResearchContext,
} from "../research/gather.js";

export type ResearchCliArgs = {
  query: string;
  json?: boolean;
  /** Override the Anthropic model for synthesis. */
  model?: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

const RESEARCH_SYSTEM_PROMPT = `You are Dia, a DevRev implementation engineer assistant. You have been given structured data gathered from a DevRev organization's internal systems. Your job is to synthesize this raw data into a clear, actionable research report.

Guidelines:
- Focus on insights that help a sales engineer prepare for a demo, POC, or customer call.
- Highlight patterns: recurring issue themes, high-severity clusters, account health signals.
- Call out gaps: missing KB articles, parts with no issues, accounts with no recent activity.
- Be concise — bullet points over paragraphs. Use markdown formatting.
- If the data is sparse, say so honestly and suggest what additional data would help.
- Never fabricate data. Only reference what appears in the provided context.
- Structure the report with clear sections: Executive Summary, Key Findings, Recommendations.`;

export async function researchCommand(args: ResearchCliArgs): Promise<void> {
  loadEnvFiles();

  const researchPat = requireEnv("DEVREV_RESEARCH_PAT");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const defaultModel = optionalEnv("ANTHROPIC_MODEL") ?? DEFAULT_MODEL;
  const model = args.model === "pick"
    ? await pickModel(defaultModel)
    : (args.model ?? defaultModel);

  const isJson = Boolean(args.json);

  // ── Step 1: Gather data from DevRev (read-only) ──────────────────────
  const client = new ReadOnlyDevRevClient({ pat: researchPat });

  if (!isJson) {
    const orgId = await resolveOrgIdentity(client);
    console.log(`\n  Research org: ${formatOrgBanner(orgId)}`);
    console.log(`\n🔍 Researching: "${args.query}"\n`);
  }

  const ctx = await gatherResearchContext(
    client,
    args.query,
    isJson ? undefined : (msg) => console.log(`  ${msg}`),
  );

  const formattedContext = formatResearchContext(ctx);

  // Quick stats for the user.
  const stats = {
    accounts: ctx.accounts.length,
    tickets: ctx.recentTickets.length,
    issues: ctx.recentIssues.length,
    articles: ctx.articles.length,
    parts: ctx.parts.length,
  };

  if (!isJson) {
    console.log(
      `\n  📊 Gathered: ${stats.accounts} accounts, ${stats.tickets} tickets, ` +
        `${stats.issues} issues, ${stats.articles} articles, ${stats.parts} parts`,
    );
  }

  // If we found nothing at all, skip Claude and tell the user.
  const totalObjects =
    stats.accounts + stats.tickets + stats.issues + stats.articles + stats.parts;
  if (totalObjects === 0) {
    const msg =
      "No data found in the research org. Ensure DEVREV_RESEARCH_PAT points to an org with data.";
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ query: args.query, stats, report: null, error: msg }) +
          "\n",
      );
    } else {
      console.log(`\n⚠️  ${msg}`);
    }
    return;
  }

  // ── Step 2: Single Claude call for synthesis ─────────────────────────
  if (!isJson) {
    console.log("  🧠 Synthesizing report with Claude…\n");
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let report: string;
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `Research query: "${args.query}"`,
            "",
            "Here is the structured data gathered from the DevRev org:",
            "",
            formattedContext,
            "",
            "Please synthesize this into a research report. Be specific — reference display IDs and names from the data.",
          ].join("\n"),
        },
      ],
    });

    report = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isJson) {
      process.stdout.write(
        JSON.stringify({
          query: args.query,
          stats,
          report: null,
          error: `Claude synthesis failed: ${msg}`,
        }) + "\n",
      );
    } else {
      console.error(`\n✗ Claude synthesis failed: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // ── Step 3: Output ───────────────────────────────────────────────────
  if (isJson) {
    process.stdout.write(
      JSON.stringify({ query: args.query, stats, report }) + "\n",
    );
  } else {
    console.log("─".repeat(60));
    console.log(report);
    console.log("─".repeat(60));
    console.log(
      `\n✓ Research complete. Model: ${model} | Objects analyzed: ${totalObjects}`,
    );
  }
}
