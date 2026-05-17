/**
 * `dia narrative` — Generate a click-by-click demo runbook from a blueprint.
 *
 * Produces a Markdown file that an SE can follow to deliver a compelling
 * DevRev demo. The narrative separates setup (pre-flight) from live
 * presentation phases, and optionally includes discovery context from
 * an SE intake session with the prospect.
 *
 * Structure:
 * - "Before the demo" — setup steps + familiarize yourself checklist
 * - Live phases — work items, KB, integrations, AI, Computer prompts
 * - Optional --discovery flag for interactive SE intake Q&A
 */

import { writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadBlueprintFile, type Blueprint } from "../parsers/blueprint.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiscoveryAnswers = {
  /** Key use cases the prospect wants to see */
  useCases?: string;
  /** Current tools/pain points */
  currentStack?: string;
  /** Key stakeholders and their roles */
  stakeholders?: string;
  /** Specific outcomes the prospect cares about */
  desiredOutcomes?: string;
  /** Any additional context from the SE */
  additionalContext?: string;
};

export type NarrativeCliArgs = {
  blueprintPath: string;
  outputPath?: string;
  title?: string;
  persona?: string;
  includeCleanup: boolean;
  includeDiscovery: boolean;
  json: boolean;
  /** Pre-supplied discovery answers (skip interactive prompts) */
  discoveryAnswers?: DiscoveryAnswers;
};

export type NarrativeSection = {
  phase: string;
  title: string;
  talking_points: string[];
  steps: NarrativeStep[];
};

export type NarrativeStep = {
  action: "prompt" | "click" | "verify" | "note" | "wait";
  target?: string;
  detail: string;
};

// ─── Discovery Flow ────────────────────────────────────────────────────────

/** Generate discovery questions tailored to the blueprint scenario. */
function generateDiscoveryQuestions(bp: Blueprint): string[] {
  const integrations = (bp.integrations ?? []).map((i) =>
    typeof i === "string" ? i : i.name,
  );
  const questions: string[] = [];

  questions.push(
    "What are the top 2-3 use cases or workflows the prospect wants to see in this demo?",
  );

  if (integrations.length > 0) {
    questions.push(
      `The prospect currently uses ${integrations.join(" + ")}. What are their biggest pain points with the current stack?`,
    );
  } else {
    questions.push(
      "What tools/systems is the prospect currently using, and what are their biggest pain points?",
    );
  }

  questions.push(
    "Who are the key stakeholders in the room and what do they each care about? (e.g., VP Engineering cares about velocity, Head of Support cares about CSAT)",
  );

  questions.push(
    "What specific outcomes would make this demo a success for the prospect? (e.g., 'show me how a ticket traces to an engineering fix')",
  );

  return questions;
}

/** Run interactive discovery Q&A in the terminal. Returns answers or null if skipped. */
async function runDiscoveryFlow(bp: Blueprint): Promise<DiscoveryAnswers | null> {
  if (!process.stdin.isTTY) return null;

  const rl = createInterface({ input, output });
  try {
    console.log("");
    const include = (
      await rl.question(
        "Would you like to include use case information from a discovery session with the prospect? [y/N] ",
      )
    )
      .trim()
      .toLowerCase();

    if (include !== "y" && include !== "yes") {
      return null;
    }

    console.log(
      "\n─── Discovery Questions ───────────────────────────────────────────────────",
    );
    console.log("Answer each question (or press Enter to skip).\n");

    const questions = generateDiscoveryQuestions(bp);
    const answerKeys: (keyof DiscoveryAnswers)[] = [
      "useCases",
      "currentStack",
      "stakeholders",
      "desiredOutcomes",
    ];

    const answers: DiscoveryAnswers = {};
    for (let i = 0; i < questions.length; i++) {
      console.log(`  ${i + 1}. ${questions[i]}`);
      const ans = (await rl.question("     → ")).trim();
      if (ans) {
        answers[answerKeys[i]] = ans;
      }
      console.log("");
    }

    // Additional context catch-all
    console.log(
      "  5. Any additional context not captured above? (competitive intel, timeline pressures, prior demos, etc.)",
    );
    const additional = (await rl.question("     → ")).trim();
    if (additional) {
      answers.additionalContext = additional;
    }

    console.log(
      "\n─────────────────────────────────────────────────────────────────────────────\n",
    );
    return Object.keys(answers).length > 0 ? answers : null;
  } finally {
    rl.close();
  }
}

// ─── Narrative Generation ───────────────────────────────────────────────────

function generateSetupFamiliarization(bp: Blueprint): string {
  const parts = bp.parts ?? [];
  const products = parts.filter((p) => p.type === "product");
  const capabilities = parts.filter((p) => p.type === "capability");
  const features = parts.filter((p) => p.type === "feature");
  const accounts = bp.accounts ?? [];

  let setup = `### Familiarize yourself with the demo org

> Before presenting, click through these areas so you know the data is there.
> You do NOT walk the prospect through this — it's your pre-flight check.

`;

  if (products.length > 0) {
    setup += `**Product hierarchy** (Build → Parts):\n`;
    setup += `- ${products.length} product(s): ${products.map((p) => p.name).join(", ")}\n`;
    if (capabilities.length > 0) {
      setup += `- ${capabilities.length} capabilities: ${capabilities.slice(0, 5).map((c) => c.name).join(", ")}${capabilities.length > 5 ? ", ..." : ""}\n`;
    }
    if (features.length > 0) {
      setup += `- ${features.length} features: ${features.slice(0, 5).map((f) => f.name).join(", ")}${features.length > 5 ? ", ..." : ""}\n`;
    }
    setup += `- The hierarchy mirrors how the prospect's engineering thinks about ownership — product → capability → feature.\n`;
    setup += `\n`;
  }

  if (accounts.length > 0) {
    setup += `**Accounts** (Support → Customers):\n`;
    setup += `- ${accounts.length} account(s): ${accounts.slice(0, 4).map((a) => a.display_name).join(", ")}${accounts.length > 4 ? ", ..." : ""}\n`;
    setup += `- Each has domain auto-association — tickets from matching domains auto-link to the right account.\n`;
    setup += `\n`;
  }

  return setup;
}

function generateDiscoverySection(answers: DiscoveryAnswers): string {
  let section = `### Discovery context (from SE intake)\n\n`;

  if (answers.useCases) {
    section += `**Key use cases:** ${answers.useCases}\n\n`;
  }
  if (answers.currentStack) {
    section += `**Current pain points:** ${answers.currentStack}\n\n`;
  }
  if (answers.stakeholders) {
    section += `**Stakeholders in the room:** ${answers.stakeholders}\n\n`;
  }
  if (answers.desiredOutcomes) {
    section += `**Success criteria:** ${answers.desiredOutcomes}\n\n`;
  }
  if (answers.additionalContext) {
    section += `**Additional context:** ${answers.additionalContext}\n\n`;
  }

  return section;
}

function generatePreamble(
  bp: Blueprint,
  title: string,
  persona: string,
  blueprintFile: string,
  discovery?: DiscoveryAnswers | null,
): string {
  const name = bp.name ?? title;
  const desc = bp.description ?? "DevRev POC demo environment.";
  const brief = bp.description ?? bp.name ?? "POC environment";

  let preamble = `# ${name}

> **Demo Runbook** — A guided narrative for delivering this DevRev demo.
> Audience: prospect stakeholders. Presenter: ${persona}.

**Persona:** ${persona}
**Blueprint:** ${blueprintFile}
**Description:** ${desc}

---

## Before the demo

> These are setup steps. Do NOT demo this part — it happens beforehand.

- [ ] You have a DevRev org with Admin access
- [ ] \`dia doctor\` passes all checks
- [ ] Your \`.env\` file has valid \`DEVREV_PAT\` and \`ANTHROPIC_API_KEY\`
${bp.integrations?.length ? `- [ ] Integration credentials ready: ${bp.integrations.map((i) => typeof i === "string" ? i : i.name).join(", ")}` : ""}
- [ ] Run \`dia apply -b ${blueprintFile}\` to stand up the demo org
- [ ] Confirm the summary shows 0 failed steps (skipped items like duplicate groups/stages are fine)
- [ ] Open DevRev in your browser, logged into the demo org

To regenerate fresh from a prompt:

\`\`\`
dia start "${brief}" --yes
\`\`\`

${generateSetupFamiliarization(bp)}`;

  if (discovery) {
    preamble += generateDiscoverySection(discovery);
  }

  preamble += `---

`;
  return preamble;
}

function generateWorksPhase(bp: Blueprint): NarrativeSection | null {
  const works = bp.works ?? [];
  const tickets = works.filter((w) => w.type === "ticket");
  const issues = works.filter((w) => w.type === "issue");
  const hasConversations = Boolean(bp.generate_conversations);
  const hasCsv = bp.csv?.some((c) => c.entity === "tickets" || c.entity === "issues");

  if (works.length === 0 && !hasCsv) return null;

  const steps: NarrativeStep[] = [];

  if (tickets.length > 0 || hasCsv) {
    steps.push({
      action: "click",
      target: "DevRev sidebar → Support → Tickets",
      detail: "Open the ticket queue to see customer-facing work items.",
    });

    steps.push({
      action: "verify",
      target: "Ticket list",
      detail: `Confirm tickets are populated${tickets.length > 0 ? ` (${tickets.length} from blueprint)` : ""}${hasCsv ? " + CSV-imported records" : ""}. Each is assigned to the correct part.`,
    });
  }

  if (issues.length > 0) {
    steps.push({
      action: "click",
      target: "DevRev sidebar → Build → Issues",
      detail: "Switch to the engineering issue tracker.",
    });

    steps.push({
      action: "verify",
      target: "Issue list",
      detail: `Confirm ${issues.length} issue(s) exist with proper priority levels and part assignments.`,
    });
  }

  if (hasConversations) {
    steps.push({
      action: "click",
      target: "Any ticket → Timeline tab",
      detail: "Open a ticket's timeline to show realistic conversation threads that Dia generated.",
    });

    steps.push({
      action: "note",
      detail: `Each ticket has ~${bp.generate_conversations?.per_ticket ?? 2} conversation entries simulating customer↔agent interactions.`,
    });
  }

  return {
    phase: "Phase 3",
    title: "Work Items Walkthrough",
    talking_points: [
      "Tickets represent customer-facing requests; issues represent internal engineering work",
      "Every work item is linked to a part in the hierarchy for automatic routing",
      ...(hasConversations
        ? ["Timeline shows realistic conversation threads — the org looks lived-in from day one"]
        : []),
    ],
    steps,
  };
}

function generateArticlesPhase(bp: Blueprint): NarrativeSection | null {
  const articles = bp.articles ?? [];
  const hasCsvArticles = bp.csv?.some((c) => c.entity === "articles");
  if (articles.length === 0 && !hasCsvArticles) return null;

  const steps: NarrativeStep[] = [];

  steps.push({
    action: "click",
    target: "DevRev sidebar → Support → Knowledge Base",
    detail: "Open the knowledge base to show published articles.",
  });

  steps.push({
    action: "verify",
    target: "Articles list",
    detail: `Confirm ${articles.length} article(s) exist${hasCsvArticles ? " + CSV-imported articles" : ""}. Each is attached to the relevant part.`,
  });

  if (articles.some((a) => a.resource_url)) {
    steps.push({
      action: "click",
      target: "An article with a linked URL",
      detail: "Show how articles can reference external documentation (Confluence, Help Center, docs sites).",
    });
  }

  return {
    phase: "Phase 4",
    title: "Knowledge Base",
    talking_points: [
      "KB articles provide self-serve resolution for customers",
      "Articles link to the product hierarchy so AI-powered search knows which docs are relevant",
      "The AI agent (PLuG) uses these articles for grounded responses",
    ],
    steps,
  };
}

function generateCustomObjectsPhase(bp: Blueprint): NarrativeSection | null {
  // custom_objects may not exist in older blueprint schemas — use dynamic access
  const cos: Array<{ leaf_type: string; subtypes?: string[]; data_source?: string }> =
    (bp as Record<string, unknown>).custom_objects as typeof cos ?? [];
  if (cos.length === 0) return null;

  const steps: NarrativeStep[] = [];

  steps.push({
    action: "click",
    target: "DevRev sidebar → Settings → Custom Objects",
    detail: "Navigate to custom objects to show the schema(s) Dia created.",
  });

  for (const co of cos) {
    steps.push({
      action: "verify",
      target: `Custom object type: ${co.leaf_type}`,
      detail: `Confirm the "${co.leaf_type}" type exists${co.subtypes?.length ? ` with subtypes: ${co.subtypes.join(", ")}` : ""}${co.data_source ? `. Records loaded from ${co.data_source}` : ""}.`,
    });
  }

  steps.push({
    action: "note",
    detail: "Custom objects extend DevRev's data model for industry-specific entities — assets, bookings, inventory, IoT readings, etc.",
  });

  return {
    phase: "Phase 5",
    title: "Custom Objects",
    talking_points: [
      "DevRev's custom objects let you model any domain entity",
      "Schema is auto-inferred from your data — no manual field mapping",
      `${cos.length} custom type(s) created: ${cos.map((c: { leaf_type: string }) => c.leaf_type).join(", ")}`,
    ],
    steps,
  };
}

function generateIntegrationsPhase(bp: Blueprint): NarrativeSection | null {
  if (!bp.integrations?.length) return null;

  const steps: NarrativeStep[] = [];
  const integrationNames = bp.integrations.map((i) => (typeof i === "string" ? i : i.name));

  steps.push({
    action: "click",
    target: "DevRev sidebar → Settings → Integrations",
    detail: "Open the integrations panel.",
  });

  for (const name of integrationNames) {
    steps.push({
      action: "click",
      target: `Integration: ${name}`,
      detail: `Configure the ${name} integration following Dia's UI guidance (see the plan output for step-by-step instructions).`,
    });
  }

  return {
    phase: "Phase 6",
    title: "Integrations Setup",
    talking_points: [
      "DevRev connects bidirectionally with your existing tools",
      `This POC uses: ${integrationNames.join(", ")}`,
      "Dia generates step-by-step UI playbooks since integration setup requires OAuth flows",
    ],
    steps,
  };
}

function generateAIPhase(bp: Blueprint): NarrativeSection | null {
  if (!bp.plug_config) return null;

  const steps: NarrativeStep[] = [];
  const pc = bp.plug_config;

  steps.push({
    action: "click",
    target: "DevRev sidebar → Support → PLuG Settings",
    detail: "Open the PLuG chat widget configuration.",
  });

  if (pc.ai_agent_enabled) {
    steps.push({
      action: "verify",
      target: "AI Agent toggle",
      detail: "Confirm AI Agent is enabled. It uses the KB articles as grounding context.",
    });
  }

  if (pc.ai_grounding_notes) {
    steps.push({
      action: "note",
      detail: `AI grounding notes: "${pc.ai_grounding_notes}"`,
    });
  }

  steps.push({
    action: "click",
    target: "PLuG widget preview (or test deployment)",
    detail: "Open the widget to demonstrate the AI agent responding to a customer question using KB articles.",
  });

  steps.push({
    action: "prompt",
    target: "PLuG chat widget",
    detail: "Ask a question that one of the KB articles answers. The AI agent should respond with grounded information.",
  });

  return {
    phase: "Phase 7",
    title: "AI Agent Demo",
    talking_points: [
      "The AI agent uses your KB articles as ground truth — no hallucination",
      "When it can't answer confidently, it creates a ticket for human follow-up",
      "Setup is one toggle + grounding notes — no ML training required",
    ],
    steps,
  };
}

function generateComputerPhase(bp: Blueprint): NarrativeSection {
  const steps: NarrativeStep[] = [];

  steps.push({
    action: "note",
    detail: "These are example prompts you can paste into Computer (DevRev's AI teammate) to demonstrate its capabilities against the POC data.",
  });

  // Generate contextual prompts based on what's in the blueprint
  const parts = bp.parts ?? [];
  const works = bp.works ?? [];
  const products = parts.filter((p) => p.type === "product");

  if (products.length > 0) {
    steps.push({
      action: "prompt",
      target: "Computer DM",
      detail: `\`\`\`\nWhat are the open tickets on ${products[0].name}? Summarize the themes.\n\`\`\``,
    });
  }

  if (works.some((w) => w.type === "ticket")) {
    steps.push({
      action: "prompt",
      target: "Computer DM",
      detail: `\`\`\`\nWhich tickets are highest priority right now? Give me the top 5 with their status.\n\`\`\``,
    });
  }

  if (works.some((w) => w.type === "issue")) {
    steps.push({
      action: "prompt",
      target: "Computer DM",
      detail: `\`\`\`\nShow me all open issues grouped by capability. Which area has the most work?\n\`\`\``,
    });
  }

  if (bp.accounts?.length) {
    steps.push({
      action: "prompt",
      target: "Computer DM",
      detail: `\`\`\`\nGive me a health summary for the ${bp.accounts[0].display_name} account.\n\`\`\``,
    });
  }

  if (bp.articles?.length) {
    steps.push({
      action: "prompt",
      target: "Computer DM",
      detail: `\`\`\`\nWhat KB articles do we have? Which parts of the product do they cover?\n\`\`\``,
    });
  }

  // Always include a meta-question
  steps.push({
    action: "prompt",
    target: "Computer DM",
    detail: `\`\`\`\nSummarize the current state of our org — how many open tickets, issues by priority, and any patterns you see.\n\`\`\``,
  });

  return {
    phase: "Phase 8",
    title: "Computer AI Prompts",
    talking_points: [
      "Computer can query across all DevRev objects — tickets, issues, accounts, articles",
      "It understands the product hierarchy and can group/filter intelligently",
      "These prompts work against the demo data we just created",
    ],
    steps,
  };
}

function generateCleanupPhase(): NarrativeSection {
  return {
    phase: "Teardown",
    title: "Cleanup",
    talking_points: [
      "Dia tracks everything it creates in a manifest",
      "One command removes all demo data in the correct dependency order",
      "The org is clean for the next demo",
    ],
    steps: [
      {
        action: "prompt",
        target: "Terminal",
        detail: "When the demo is over, tear down the environment:\n\n```\ndia cleanup\n```\n\nOr keep the product hierarchy for reuse:\n\n```\ndia cleanup --keep-parts\n```",
      },
      {
        action: "verify",
        target: "Terminal output",
        detail: "Confirm all objects deleted successfully. Custom stages may show as 'skipped' (no delete API).",
      },
    ],
  };
}

// ─── Markdown Rendering ─────────────────────────────────────────────────────

function renderStep(step: NarrativeStep, index: number): string {
  const icon = {
    prompt: "💬",
    click: "🖱️",
    verify: "✅",
    note: "📝",
    wait: "⏳",
  }[step.action];

  const targetStr = step.target ? ` **${step.target}**` : "";
  return `${index + 1}. ${icon}${targetStr}\n\n   ${step.detail.split("\n").join("\n   ")}\n`;
}

function renderSection(section: NarrativeSection): string {
  let md = `## ${section.phase}: ${section.title}\n\n`;

  // Talking points as a callout
  md += `> **Key talking points:**\n`;
  for (const tp of section.talking_points) {
    md += `> - ${tp}\n`;
  }
  md += "\n";

  // Steps
  md += "### Steps\n\n";
  for (let i = 0; i < section.steps.length; i++) {
    md += renderStep(section.steps[i], i) + "\n";
  }

  md += "---\n\n";
  return md;
}

// ─── Main Export ────────────────────────────────────────────────────────────

export function generateNarrative(
  bp: Blueprint,
  options: {
    title: string;
    persona: string;
    blueprintFile: string;
    includeCleanup: boolean;
    discovery?: DiscoveryAnswers | null;
  },
): string {
  const sections: NarrativeSection[] = [];

  // NOTE: Setup and product hierarchy are now in the "Before the demo" preamble.
  // The live demo starts with the value story — work items, traceability, AI.

  // Conditional phases based on blueprint content (live demo starts here)
  const worksPhase = generateWorksPhase(bp);
  if (worksPhase) sections.push(worksPhase);

  const articlesPhase = generateArticlesPhase(bp);
  if (articlesPhase) sections.push(articlesPhase);

  const customObjectsPhase = generateCustomObjectsPhase(bp);
  if (customObjectsPhase) sections.push(customObjectsPhase);

  const integrationsPhase = generateIntegrationsPhase(bp);
  if (integrationsPhase) sections.push(integrationsPhase);

  const aiPhase = generateAIPhase(bp);
  if (aiPhase) sections.push(aiPhase);

  // Always include Computer prompts
  sections.push(generateComputerPhase(bp));

  // Renumber phases based on what's actually present
  sections.forEach((s, i) => {
    if (s.phase !== "Teardown") {
      s.phase = `Phase ${i + 1}`;
    }
  });

  // Optional cleanup
  if (options.includeCleanup) {
    sections.push(generateCleanupPhase());
  }

  // Render to Markdown
  let md = generatePreamble(bp, options.title, options.persona, options.blueprintFile, options.discovery);
  for (const section of sections) {
    md += renderSection(section);
  }

  // Appendix: raw blueprint reference
  md += `## Appendix: Blueprint Source\n\n`;
  md += `The blueprint file used: \`${options.blueprintFile}\`\n\n`;
  md += `To recreate this demo from scratch:\n\n`;
  md += "```bash\n";
  md += `dia apply -b ${options.blueprintFile}\n`;
  md += "```\n\n";
  md += `Or generate fresh from the description:\n\n`;
  md += "```bash\n";
  md += `dia start "${bp.description ?? bp.name ?? "POC"}" --yes\n`;
  md += "```\n";

  return md;
}

// ─── CLI Command Handler ────────────────────────────────────────────────────

export async function narrativeCommand(args: NarrativeCliArgs): Promise<void> {
  const blueprintPath = resolve(args.blueprintPath);
  const bp = await loadBlueprintFile(blueprintPath);

  const title = args.title ?? bp.name ?? basename(blueprintPath, ".json");
  const persona = args.persona ?? "Sales Engineer";
  const blueprintFile = basename(blueprintPath);

  // Optional discovery flow — ask SE for prospect context
  let discovery: DiscoveryAnswers | null = null;
  if (args.discoveryAnswers) {
    discovery = args.discoveryAnswers;
  } else if (args.includeDiscovery) {
    discovery = await runDiscoveryFlow(bp);
  }

  const markdown = generateNarrative(bp, {
    title,
    persona,
    blueprintFile,
    includeCleanup: args.includeCleanup,
    discovery,
  });

  if (args.json) {
    const json = {
      title,
      persona,
      blueprint: blueprintFile,
      discovery,
      markdown,
    };
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    return;
  }

  if (args.outputPath) {
    const outPath = resolve(args.outputPath);
    await writeFile(outPath, markdown, "utf8");
    console.log(`\n  ✓ Demo narrative written to: ${outPath}`);
    console.log(`    ${markdown.split("\n").length} lines, ready to deliver.\n`);
    if (discovery) {
      console.log(`    Discovery context included from SE intake.\n`);
    }
  } else {
    process.stdout.write(markdown);
  }
}
