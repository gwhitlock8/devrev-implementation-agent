# Dia

**Your DevRev implementation engineer.** Dia stands up DevRev POC orgs from a natural-language brief — she synthesizes a blueprint, builds a deterministic plan, executes it against the DevRev REST API, and cleans up when you're done.

Built for sales engineers who need a demo-ready org in minutes, not hours.

```
"Stand up a SaaS support POC for Lumio with 3 capabilities,
 12 inbound tickets, 8 KB articles, Slack integration,
 and an Enterprise SLA tier"

          ↓

  Org: example_org (DEV-1xxxxxxx) — Gavin <gavin@devrev.ai>

  Applying 60 step(s)…

  ✓ [1/60] Create product "Lumio"  → PROD-1
  ✓ [2/60] Create capability "Authentication"  → CAPL-1
  …
  ✓ [60/60] Create timeline entry on TKT-12

  Done: 60 ok, 0 failed, 0 skipped.
```

---

## How she works

```
                         ┌─────────────────────────────────┐
  NL brief or blueprint  │  Claude planner (tool-use loop)  │
  ─────────────────────> │  + DevRev MCP org lookups        │
                         └──────────────┬──────────────────┘
                                        │
                                  blueprint.json
                                        │
                         ┌──────────────▼──────────────────┐
                         │  Deterministic plan builder       │
                         │  Validates hierarchy, refs, lint  │
                         └──────────────┬──────────────────┘
                                        │
                                    plan.json
                                        │
                         ┌──────────────▼──────────────────┐
                         │  Resilient executor               │
                         │  Retry, backoff, idempotent refs  │
                         │  Per-step audit log + progress    │
                         └──────────────┬──────────────────┘
                                        │
                                 DevRev org ready
```

1. **Describe** what you need in plain English — or hand Dia a blueprint JSON.
2. **Review** the generated blueprint and plan before anything touches DevRev.
3. **Apply** — Dia creates parts, tickets, articles, accounts, contacts, tags, groups, links, and timeline entries via the DevRev REST API. Per-step progress shows each object as it's created.
4. **Cleanup** — when the demo is over, Dia deletes everything she created in the correct reverse-dependency order, with a per-category breakdown.
5. **Research** — query your internal DevRev org (read-only) and get a Claude-synthesized intelligence report.

---

## Quickstart

```bash
# Install
git clone <repo-url> && cd devrev-impl-agent
npm install && npm run build && npm link

# Configure
cp .env.example .env
# Add your DEVREV_PAT and ANTHROPIC_API_KEY to .env
# Optionally add DEVREV_RESEARCH_PAT for `dia research`

# Check your setup
dia doctor

# Plan a POC from natural language
dia plan "SaaS support POC for Acme with auth, billing, and integrations capabilities"

# Review the plan, then apply
dia apply

# When you're done, clean up
dia cleanup
```

---

## Configuration

Copy [.env.example](.env.example) to `.env` or export variables directly:

| Variable | Required for | Description |
|----------|-------------|-------------|
| `DEVREV_PAT` | All commands except `generate`, `research` | Personal access token for the demo org — [DevRev auth docs](https://developer.devrev.ai/about/authentication) |
| `DEVREV_RESEARCH_PAT` | `research` | Read-only PAT scoped to your internal DevRev org. Never used for create/update/delete. |
| `ANTHROPIC_API_KEY` | `plan`, `start`, `research` | Powers the Claude planner and research synthesis |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-4-6` |
| `DEVREV_BETA` | Optional | Set to `1` for `X-Devrev-Scope: beta` |
| `DEVREV_MCP_COMMAND` | Optional | Custom MCP server command (default: `dia mcp-serve`) |
| `DEVREV_MCP_ARGS` | Optional | Args for the MCP command (default: `mcp-serve`) |

**Dual-PAT architecture:** `DEVREV_PAT` targets your demo/POC org and powers all mutations. `DEVREV_RESEARCH_PAT` targets your internal DevRev org and is enforced read-only at the client level — the `ReadOnlyDevRevClient` blocks any `.create`, `.update`, or `.delete` call before it reaches the network.

**Never** commit tokens or paste them into plans/logs. Dia redacts sensitive values in all audit output.

---

## Org identity

Every mutating command prints the org it's targeting before doing anything:

```
  Org: gdubtx (DEV-1jDEIKbvWW) — Gavin Whitlock <gavin.whitlock@devrev.ai>
```

This is resolved via `dev-orgs.get` (inferred from the PAT) so you always know which org you're about to modify. The research command shows its own org context:

```
  Research org: DevRev (DEV-0) — Gavin Whitlock <gavin.whitlock@devrev.ai>
```

`dia doctor` validates both PATs and shows both orgs side by side.

---

## Commands

### `dia plan` — synthesize a blueprint and plan

Give Dia a natural-language brief and she'll produce a `blueprint.json` (what to create) and a `plan.json` (ordered API steps):

```bash
dia plan "Stand up a POC for fintech company Initech with auth, payments, and compliance capabilities, 15 support tickets, and a Slack integration"
```

Or point her at an existing blueprint:

```bash
dia plan -b blueprints/freshdesk-migration.json -o ./my-migration
```

### `dia apply` — execute the plan against DevRev

```bash
dia apply                          # uses ./poc-output/plan.json
dia apply -o ./my-migration        # specify output directory
dia apply --dry-run                # preview without mutations
dia apply --resume                 # pick up where a failed run left off
dia apply --json                   # machine-readable summary
```

Dia creates objects in dependency order (parts first, then articles, works, accounts, contacts, links, timeline entries). Each step prints live progress:

```
  Org: gdubtx (DEV-1jDEIKbvWW) — Gavin Whitlock <gavin.whitlock@devrev.ai>

  Applying 42 step(s)…

  ✓ [1/42] Create product "Lumio"  → PROD-1
  ✓ [2/42] Create capability "Auth"  → CAPL-1
  ~ [3/42] Create group "Tier-1 Support"  → reused existing GRP-5
  ✓ [4/42] Create tag "priority:high"  → TAG-12
  …
  Done: 40 ok, 0 failed, 2 skipped.
```

If something fails midway, `--resume` skips completed steps and retries from the failure point. Groups with duplicate names are automatically reused instead of failing.

### `dia cleanup` — reset the org after a demo

```bash
dia cleanup -o ./my-migration              # delete everything Dia created
dia cleanup -o ./my-migration --keep-parts # keep the product hierarchy, delete data
dia cleanup --dry-run                      # preview what would be deleted
```

Dia reads the manifest from a prior apply and deletes objects in reverse dependency order: timeline entries, links, works, articles, tags, custom stages, groups, rev_orgs, accounts, and finally parts (leaf-first). The output includes a per-category breakdown:

```
  Org: gdubtx (DEV-1jDEIKbvWW) — Gavin Whitlock <gavin.whitlock@devrev.ai>

  ✓ works.delete  TKT-123
  ✓ articles.delete  ART-45
  ~ stages.custom.delete  CSTG-1  (no delete API — skipped)
  ✓ groups.delete  GRP-5
  …

  Done: 38 deleted, 0 failed, 2 skipped.

  Works: 12 deleted
  Articles: 8 deleted
  Tags: 4 deleted
  Custom stages: 2 skipped
  Groups: 1 deleted
  Accounts: 3 deleted
  Parts: 8 deleted
```

Notes on specific object types:
- **Groups** are deleted via the internal gateway (`groups.delete` isn't on the public API).
- **Custom stages** have no delete endpoint on any API surface — Dia skips them gracefully.
- **Already-deleted objects** are detected (HTTP 404) and skipped without failing.

### `dia empty` — nuke the entire org

```bash
dia empty              # interactive confirmation required
dia empty --yes        # skip confirmation (scripted use)
dia empty --dry-run    # preview only
dia empty --json       # machine-readable output
```

Unlike `cleanup` (which reads a manifest), `empty` discovers all user-created objects in the org via list endpoints and deletes everything. Useful for resetting a demo org to a clean slate regardless of how the objects were created.

```
  Org: gdubtx (DEV-1jDEIKbvWW) — Gavin Whitlock <gavin.whitlock@devrev.ai>

  Discovering objects in the org…

  Found 47 object(s) to delete:

    Works: 20
    Articles: 10
    Tags: 5
    Groups: 2
    Accounts: 4
    Parts: 6

  ⚠️  This will delete ALL user-created objects. Type 'yes' to confirm: yes

  ✓ [1/47] works.delete  TKT-1
  …
  Done: 45 deleted, 0 failed, 2 skipped.
```

Safety measures:
- **Confirmation gate** — requires typing "yes" unless `--yes` is passed.
- **Skips system objects** — default groups (`is_default`), system rev_orgs (no account association).
- **Dependency ordering** — works before accounts, accounts before parts, parts leaf-first.
- **Org identity shown** — you always see which org you're about to empty.

### `dia research` — intelligence from your internal org

```bash
dia research "What are the most common customer issues?"
dia research "account health for Acme Corp" --json
dia research "top ticket themes" --model claude-opus-4-7
```

Queries your internal DevRev org (via `DEVREV_RESEARCH_PAT`) and synthesizes a report with Claude. The workflow is token-efficient: all data gathering uses DevRev REST APIs directly (zero Anthropic tokens), with a single Claude call at the end for synthesis.

```
  Research org: DevRev (DEV-0) — Gavin Whitlock <gavin.whitlock@devrev.ai>

  🔍 Researching: "What are the most common customer issues?"

    Searching accounts…
    Loading recent tickets…
    Loading recent issues…
    Loading KB articles…
    Loading parts hierarchy…

    📊 Gathered: 3 accounts, 25 tickets, 25 issues, 30 articles, 150 parts
    🧠 Synthesizing report with Claude…

  ────────────────────────────────────────────────────────────
  # DevRev Org Research Report
  ## Executive Summary
  …
  ## Key Findings
  …
  ## Recommendations
  …
  ────────────────────────────────────────────────────────────

  ✓ Research complete. Model: claude-sonnet-4-6 | Objects analyzed: 233
```

**Read-only guarantee:** The `ReadOnlyDevRevClient` enforces an allowlist of operations (`*.list`, `*.get`, `*.search`, `dev-users.self`, `*.export`). Any mutating call is blocked at the client layer before reaching the network.

### `dia snapshot` — export live org state as a blueprint

```bash
dia snapshot                                    # snapshot to snapshot-<timestamp>.json
dia snapshot -o my-org.json                     # named output
dia snapshot --no-works                         # parts, tags, stages, groups, accounts only
dia snapshot --no-customers                     # parts, tags, stages, groups, works, articles only
dia snapshot --max-works 100 --max-accounts 50  # raise the default caps
dia snapshot --json                             # machine-readable output
```

Connects to your org using `DEVREV_PAT`, pages through every object type, and writes a portable `blueprint.json` you can immediately feed back into `dia plan` + `dia apply` to seed a new org.

```
  Snapshotting org: gdubtx (DEV-0) — Gavin Whitlock <gavin.whitlock@devrev.ai>

  📸 Gathering org objects…

    Listing parts…
    Listing tags…
    Listing custom stages…
    Listing groups…
    Listing accounts…
    Listing rev orgs…
    Listing rev users…
    Listing tickets…
    Listing issues…
    Listing articles…

  📊 Captured:
     Parts:         42
     Tags:          9
     Custom stages: 4
     Groups:        5
     Accounts:      12
     Rev orgs:      12
     Rev users:     38
     Works:         50
     Articles:      27

✓ Snapshot written to: snapshot-1747012345678.json
  Total objects: 199

Next steps:
  Review and edit the snapshot before applying — remove sensitive data,
  trim works to a representative sample, and adjust any refs that collide.
  Then apply to a fresh org:
    dia plan --blueprint snapshot-1747012345678.json
    dia apply
```

**What is captured:** parts hierarchy, tags, custom stages, groups, accounts, rev orgs, rev users, works (tickets + issues), and KB articles.

**What is intentionally omitted:** timeline entries (ephemeral conversation data), SLA policies (no public list endpoint), links (require both objects to exist first — add manually), plug_config (org-level setting), and CSV generators (not needed for live data).

**Default caps per object type:** 20 accounts, 30 rev orgs, 50 rev users, 50 works, 40 articles. All caps are overridable with `--max-*` flags.

### `dia start` — one-shot pipeline

Plan and apply in a single command:

```bash
dia start "Quick demo with 1 product, 5 tickets, and 3 KB articles" --yes
```

Flags: `--yes` (skip confirmation), `--dry-run`, `--plan-only`, `--no-mcp`, `-o <dir>`, `-b <blueprint>`.

### `dia generate` — synthetic data

```bash
dia generate saas-support -e tickets -r 50 --seed 42 > tickets.csv
dia generate b2b-sales -e contacts -r 25 -o contacts.csv
dia generate dev-tooling -e articles -r 10 > kb.csv
```

Scenarios: `saas-support` | `b2b-sales` | `dev-tooling`. Entities: `contacts` | `accounts` | `tickets` | `issues` | `articles`. Seeded output is deterministic — same seed, same data.

### `dia verify` — confirm manifest state

```bash
dia verify -o ./my-migration
```

Walks the manifest and uses the DevRev MCP to confirm every created object still exists in the org.

### `dia doctor` — environment check

```bash
dia doctor
```

Validates all PATs, reports org identity, checks for the Anthropic API key, and tests MCP connectivity:

```
✓ DevRev PAT is valid (REST API).
  Org: gdubtx (DEV-1jDEIKbvWW)
  User: Gavin Whitlock (gavin.whitlock@devrev.ai)
  display_id: DEVU-1  id: don:identity:dvrv-us-1:devo/1jDEIKbvWW:devu/1
  User state: active
✓ DEVREV_RESEARCH_PAT is valid (read-only).
  Research org: DevRev (DEV-0) — Gavin Whitlock <gavin.whitlock@devrev.ai>
✓ ANTHROPIC_API_KEY present.
✓ DevRev MCP connected via built-in `dia mcp-serve`. 2 tools available.
```

Run this before your first apply — Dia will warn if she can't confirm Admin role (required for integration installs and SLA setup).

---

## Blueprints

A blueprint is a JSON file describing what Dia should create. She generates these from natural language, but you can also write or edit them by hand.

### What Dia can create via the API

| Blueprint section | DevRev API | Description |
|-------------------|-----------|-------------|
| `parts[]` | `parts.create` | Product hierarchy: product, capability, feature, enhancement |
| `works[]` | `works.create` | Tickets, issues, tasks, opportunities |
| `articles[]` | `articles.create` | KB articles (title + optional URL resource) |
| `accounts[]` | `accounts.create` | Customer accounts with domains |
| `rev_users[]` | `rev-users.create` | Customer contacts |
| `rev_orgs[]` | `rev-orgs.create` | Customer workspaces |
| `links[]` | `links.create` | Relationships between objects |
| `timeline_entries[]` | `timeline-entries.create` | Comments on works |
| `incidents[]` | `works.create` | Incident objects |
| `tags[]` | `tags.create` | Categorization tags for tickets, issues, and articles |
| `custom_stages[]` | `stages.custom.create` | Custom ticket/issue lifecycle stages |
| `groups[]` | `groups.create` | Support teams and routing groups |

### What Dia generates as UI guidance

These features aren't API-automatable — Dia produces detailed, step-by-step setup playbooks instead:

| Blueprint section | What it renders |
|-------------------|----------------|
| `sla_policies[]` | SLA target tables with priority-specific first-response and resolution times |
| `email_channels[]` | Inbound email setup with keyword routing and sender configuration |
| `plug_config` | PLuG chat widget deployment with AI agent grounding |
| `integrations[]` | Per-integration playbooks (Slack, Jira, Salesforce, Freshdesk, Zendesk, HubSpot, WhatsApp, Feature Request Handler) |
| `ui_guidance[]` | Free-form steps for anything the templates don't cover |

### Hierarchy rules

DevRev enforces a strict parts hierarchy. Dia validates this at plan time — hierarchy violations are caught before any API call:

```
product
  └── capability
        └── feature
              └── enhancement
```

- **Products** are top-level only — no parent.
- **Capabilities** must parent to a product.
- **Features** must parent to a capability — never directly to a product.
- **Enhancements** parent to a capability or feature.

### Priority mapping

Blueprints use friendly `p0` / `p1` / `p2` / `p3` strings. Dia maps them to the correct API field per work type:

| Blueprint | Tickets (`severity`) | Issues (`priority_v2`) |
|-----------|---------------------|----------------------|
| `p0` | `blocker` | `1` |
| `p1` | `high` | `2` |
| `p2` | `medium` | `3` |
| `p3` | `low` | `4` |

### Conversations

For realistic ticket threads, add `generate_conversations` to the blueprint:

```json
{
  "generate_conversations": {
    "scenario": "saas-support",
    "per_ticket": 2,
    "seed": 42
  }
}
```

Dia generates alternating customer/agent exchanges on every ticket — the cheapest way to make a demo org look lived-in.

---

## Migration blueprints

Pre-built starting points for the dominant displacement scenarios and showcase use cases:

- **[`blueprints/freshdesk-migration.json`](blueprints/freshdesk-migration.json)** — Parallel-run setup with seeded KB articles, sample tickets, conversation threads, priority mapping, and Freshdesk Airsync steps. Validated 63/63.

- **[`blueprints/zendesk-migration.json`](blueprints/zendesk-migration.json)** — Adapted for Zendesk customers: Brand-to-Part mapping, Help Center article import, Zendesk Airsync steps. Validated 74/74.

- **[`blueprints/jira-migration.json`](blueprints/jira-migration.json)** — Engineering-focused migration: Jira Project→Product, Component→Capability, Epic→Feature mapping. Includes custom stages mirroring a Kanban workflow (Backlog → Selected → In Progress → In Review → Done), tags for Jira issue types (bug, story, task, epic), team groups, 20 seeded issues, Jira Airsync playbook, and CSV import guidance. Validated 50/50.

- **[`blueprints/hubspot-migration.json`](blueprints/hubspot-migration.json)** — CRM-to-support migration: HubSpot Companies→Accounts, Contacts→Rev Users, Deals/Opportunities linkage. Includes tiered SLA policies (enterprise/growth/starter), three sample accounts with seeded rev users, realistic B2B support tickets, KB articles, custom stages (Pending Customer, Escalated, Pending Engineering), and a full HubSpot AirSync parallel-run + cutover playbook. Validated 139/139.

- **[`blueprints/servicenow-migration.json`](blueprints/servicenow-migration.json)** — ITSM-to-support migration: ServiceNow Incidents→tickets, Change Requests and Problems→issues, CMDB CIs→parts hierarchy, Service Catalog→KB articles, Assignment Groups→DevRev groups. Includes five custom stages mirroring the ServiceNow workflow (Pending Approval, In Review, Pending Vendor, Pending User, Resolved), three tiered SLA policies (enterprise, commercial, HIPAA), realistic IT incidents and change requests, an AirSync parallel-run playbook, and a week-by-week cutover guide. Validated 181/181.

- **[`blueprints/ai-first-showcase.json`](blueprints/ai-first-showcase.json)** — AI-native support showcase for PLuG + Turing demos. Built around a fictional SaaS company (Velo Analytics) with a realistic product hierarchy, 8 carefully designed tickets that illustrate the full AI spectrum — deflected how-to questions, autonomous connector troubleshooting, sentiment-triggered churn-risk escalation, P0 outage immediate human handoff, and billing-question guardrails. Includes 9 KB articles (7 published for AI grounding, 2 internal SE resources), AI-annotated internal timeline entries showing Turing's scoring in action, 4 custom stages (AI Handling, Awaiting User, Escalated to Human, AI Resolved), 5 routing groups, 2 SLA tiers, and 7 ui_guidance sections covering PLuG setup, Turing triage, sentiment escalation, deflection metrics, and a 5-minute demo script. Validated 203/203.

Dia **auto-detects** Freshdesk, Zendesk, Jira, HubSpot, and ServiceNow CSV header signatures and applies the right column mapping automatically. Drop your real CSV exports next to the blueprint as additional `csv` entries.

---

## Error handling

Dia provides friendly error messages for common failure modes instead of raw stack traces:

| Situation | What Dia says |
|-----------|--------------|
| Missing `DEVREV_PAT` | "Add it to your .env file or export it directly." |
| Missing `DEVREV_RESEARCH_PAT` | "Required by `dia research`. This PAT should point to your internal DevRev org." |
| Missing `ANTHROPIC_API_KEY` | "Required for NL synthesis (plan/start)." |
| Expired or invalid PAT | "Your PAT may be expired or invalid. Generate a new token at…" |
| Permission denied | "Your DevRev user may lack the required role. Run `dia doctor`." |
| Network failure | "Cannot reach the DevRev API. Check your network connection." |

Use `--verbose` on any command to see full stack traces when debugging.

---

## Gotchas Dia handles for you

Lessons from production DevRev implementations, encoded as validations and guidance:

- **Org identity** — Every command prints the target org (name, display ID, user) before executing, so you never accidentally mutate the wrong org.
- **Group duplicate names** — If a group with the same name already exists, Dia reuses it instead of failing with HTTP 400.
- **Groups internal gateway** — `groups.delete` only exists on the internal gateway. Dia routes group deletes there automatically.
- **Custom stages can't be deleted** — No delete endpoint exists on any API surface. Dia skips them gracefully during cleanup.
- **RevUser/RevOrg mismatch** — Dia warns when rev_users lack a rev_org assignment. Without it, DevRev silently drops the reporter field on tickets.
- **Duplicate part names** — Dia checks the live org for naming collisions before creating parts.
- **Ticket/issue priority split** — Tickets use `severity` (string), issues use `priority_v2` (numeric). Dia handles the conversion transparently.
- **Link type constraints** — `is_dependent_on` only works for ticket-to-issue links. Same-type links must use `is_related_to`. Dia falls back automatically when the API rejects a link type.
- **Article API limitation** — DevRev articles don't support inline body content via API. Dia creates articles with title + optional URL resource; body content goes through the UI.
- **Slack: one connection per org** — Enterprise Slack accounts need DevRev Support whitelisting. Dia's Slack integration guide flags this.
- **Email sender defaults** — Outbound emails default to the workspace name, not the agent. Dia's email channel guidance covers the fix.
- **Admin role required** — `dia doctor` warns when it can't confirm Admin, which is required for integration installs and SLA configuration.
- **Research PAT isolation** — `dia research` uses a separate read-only PAT so your internal org is never at risk of accidental mutations.

---

## Troubleshooting

### `links.create` HTTP 400

Usually an invalid `(link_type, source, target)` combo. Dia handles the common cases automatically:
- Ticket-to-issue with `is_related_to` → retries with `is_dependent_on`
- Same-type with `is_dependent_on` → retries with `is_related_to`

### `works.create` HTTP 409

The `external_ref` already exists from a previous apply. Dia reuses the existing work and updates the manifest. Reruns are safe.

### `groups.create` HTTP 400

Usually a duplicate name. Dia automatically catches this, searches for the existing group by name, and reuses it. If you see this in audit logs, it was handled — check the manifest for the reused group ID.

### Anthropic model 404

Set `ANTHROPIC_MODEL` in your `.env`:

```bash
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### MCP "command not found"

The default MCP command is `dia mcp-serve`. Make sure `dia` is on your PATH (`npm link` from this project). Alternatively, point at a different server:

```bash
DEVREV_MCP_COMMAND=/path/to/other-mcp-server
DEVREV_MCP_ARGS=
```

Without MCP, Dia skips org lookups and `verify` can't run, but everything else works.

---

## Architecture

```
src/
├── api/                  # DevRev REST client, dev-users/orgs, read-only client
│   ├── client.ts         # Base HTTP client with retry + rate-limit backoff
│   ├── devUsers.ts       # dev-users.self, dev-orgs.get, org identity resolution
│   └── readOnlyClient.ts # Allowlist-enforced read-only wrapper (for research)
├── agent/                # Claude planner (tool-use loop)
├── commands/             # CLI command handlers
│   ├── applyCmd.ts       # Execute plan with per-step progress
│   ├── cleanupCmd.ts     # Manifest-based cleanup with category breakdown
│   ├── emptyCmd.ts       # Full org wipe with discovery + confirmation
│   ├── researchCmd.ts    # Read-only research + Claude synthesis
│   ├── doctor.ts         # Environment validation (dual PAT + MCP)
│   └── …
├── research/             # Research data gathering layer
│   └── gather.ts         # Accounts, tickets, issues, articles, parts via REST
├── executor/             # Plan runner, manifest management
├── plan/                 # Blueprint → plan builder
├── parsers/              # Blueprint schema (Zod), CSV detection
├── mcp/                  # DevRev MCP client
├── logging/              # Audit logger
└── config/               # Env loader
```

---

## Development

```bash
npm install
npm run build        # tsup → dist/cli.js
npm run dev          # tsx (no build step)
npm test             # vitest
npm run lint         # eslint
```

## License

MIT
