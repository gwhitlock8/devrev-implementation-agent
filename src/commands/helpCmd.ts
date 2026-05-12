import chalk from "chalk";

const HELP_TEXT = `
${chalk.bold("Dia")} — your DevRev implementation engineer.
Blueprint → plan → apply → cleanup.

${chalk.dim("────────────────────────────────────────────────────────────")}

${chalk.bold.underline("Quick start")}

  ${chalk.cyan("dia doctor")}                        Check your PAT, API key, and MCP setup
  ${chalk.cyan("dia start")} ${chalk.dim('"<brief>"')}               Plan + apply in one shot
  ${chalk.cyan("dia plan")}  ${chalk.dim('"<brief>"')}               Synthesize a blueprint and plan (no mutations)
  ${chalk.cyan("dia apply")}                         Execute the plan against DevRev
  ${chalk.cyan("dia load")}  ${chalk.dim("<file> -l <type>")}        Import custom objects from a data file
  ${chalk.cyan("dia narrative")} ${chalk.dim("<bp.json>")}         Generate a click-by-click demo runbook
  ${chalk.cyan("dia cleanup")}                       Delete everything Dia created (reads manifest)

${chalk.bold.underline("Core commands")}

  ${chalk.cyan("dia plan")} ${chalk.dim("[brief]")}
    Generate blueprint.json, plan.json, and demo-narrative.md from a brief.
    ${chalk.dim("Options:")} --prompt-file <path>, -b <blueprint>, -o <dir>, --no-mcp, --json

  ${chalk.cyan("dia apply")}
    Execute the most recent plan against DevRev.
    ${chalk.dim("Options:")} --plan <path>, -o <dir>, --dry-run, --resume, --json

  ${chalk.cyan("dia start")} ${chalk.dim("[brief]")}
    One-shot: plan + confirm + apply in a single command.
    ${chalk.dim("Options:")} --prompt-file, -b, -o, -y/--yes, --plan-only, --dry-run, --no-mcp, --json

  ${chalk.cyan("dia cleanup")}
    Delete all objects from the last apply (reads run-manifest.json).
    ${chalk.dim("Options:")} -o <dir>, --dry-run, --keep-parts, --json

  ${chalk.cyan("dia empty")}
    ${chalk.red("Nuclear option:")} delete ALL user-created objects in the org.
    ${chalk.dim("Options:")} --dry-run, -y/--yes, --json

${chalk.bold.underline("Custom objects")}

  ${chalk.cyan("dia load")} ${chalk.dim("<file> -l <leaf-type>")}
    Import custom objects from CSV, TSV, JSON, or JSONL into DevRev.
    Auto-infers schema, creates the custom type, and bulk-loads records.
    ${chalk.dim("Options:")} -p <prefix>, -s <subtypes>, --annotate, --max-workers, --batch-size
    ${chalk.dim("         ")} --field-type-overrides <json>, --dry-run, --json

    ${chalk.dim("Example:")}
    ${chalk.cyan('dia load bookings.csv -l booking -p BOK -s "OTA,direct" --annotate')}

  ${chalk.dim("Blueprint integration:")}
    Blueprints also support a ${chalk.yellow("custom_objects[]")} section for declarative
    custom object creation via ${chalk.cyan("dia start")} / ${chalk.cyan("dia apply")}. Objects created
    this way are tracked in the manifest and cleaned up by ${chalk.cyan("dia cleanup")}.

${chalk.bold.underline("Demo narratives")}

  ${chalk.dim("Auto-generated:")} Every ${chalk.cyan("dia plan")} / ${chalk.cyan("dia start")} writes a ${chalk.yellow("demo-narrative.md")}
  alongside the blueprint and plan. No extra step needed.

  ${chalk.cyan("dia narrative")} ${chalk.dim("<blueprint.json> -o runbook.md")}
    Generate (or regenerate) a click-by-click demo runbook from a blueprint.
    Includes UI navigation, Computer prompts, talking points, and teardown.
    ${chalk.dim("Options:")} -o <path>, -t <title>, --persona <role>, --no-cleanup, --json

    ${chalk.dim("Example:")}
    ${chalk.cyan("dia narrative jira-migration.json -o demo-runbook.md")}
    ${chalk.cyan('dia narrative blueprint.json -t "Acme POC" --persona "Account Executive"')}

${chalk.bold.underline("Utilities")}

  ${chalk.cyan("dia generate")} ${chalk.dim("<scenario> -e <entity> -r <rows>")}
    Emit faker-generated CSV data for demos.
    Scenarios: saas-support | b2b-sales | dev-tooling
    Entities:  contacts | accounts | tickets | issues | articles | custom:<type>

    ${chalk.dim("Custom entity examples:")}
    ${chalk.cyan("dia generate saas-support -e custom:booking -r 50")}
    ${chalk.cyan("dia generate b2b-sales -e custom:asset -r 25 -o assets.csv")}
    ${chalk.dim("Known templates: booking, asset, inventory, order, iot, employee")}

  ${chalk.cyan("dia research")} ${chalk.dim('"<query>"')}
    Query your internal DevRev org (read-only) and get a synthesized report.
    ${chalk.dim("Options:")} --model <model>, --json

  ${chalk.cyan("dia verify")}
    Confirm every manifest entry still exists in the org via MCP.

  ${chalk.cyan("dia doctor")}
    Validate PATs, Anthropic key, org identity, and MCP connectivity.

${chalk.bold.underline("Typical workflow")}

  ${chalk.dim("1.")} ${chalk.cyan("dia doctor")}                        ${chalk.dim("# confirm setup")}
  ${chalk.dim("2.")} ${chalk.cyan('dia plan "SaaS POC for Acme…"')}     ${chalk.dim("# generate blueprint + plan + narrative")}
  ${chalk.dim("3.")} ${chalk.dim("# review poc-output/plan.json")}
  ${chalk.dim("4.")} ${chalk.cyan("dia apply")}                         ${chalk.dim("# create everything in DevRev")}
  ${chalk.dim("5.")} ${chalk.dim("# follow poc-output/demo-narrative.md to deliver the demo")}
  ${chalk.dim("6.")} ${chalk.cyan("dia cleanup")}                       ${chalk.dim("# tear it all down")}

${chalk.bold.underline("Environment variables")}

  ${chalk.yellow("DEVREV_PAT")}            Personal access token for the demo org
  ${chalk.yellow("DEVREV_RESEARCH_PAT")}   Read-only PAT for your internal org (dia research)
  ${chalk.yellow("ANTHROPIC_API_KEY")}     Powers Claude planning and research synthesis
  ${chalk.dim("ANTHROPIC_MODEL")}       Model override (default: claude-sonnet-4-6)

${chalk.dim("────────────────────────────────────────────────────────────")}

  Run ${chalk.cyan("dia <command> --help")} for detailed options on any command.
  Run ${chalk.cyan("dia doctor")} if something isn't working.
`;

export async function helpCommand(): Promise<void> {
  console.log(HELP_TEXT);
}
