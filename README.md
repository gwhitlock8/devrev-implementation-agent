# Dia

**Your DevRev implementation engineer.** Dia stands up DevRev POC orgs from a natural-language brief — she synthesizes a blueprint, builds a deterministic plan, executes it against the DevRev REST API, and cleans up when you're done.

Built for sales engineers who need a demo-ready org in minutes, not hours.

```
"Stand up a SaaS support POC for Lumio with 3 capabilities,
 12 inbound tickets, 8 KB articles, Slack integration,
 and an Enterprise SLA tier"

          ↓

  60 objects created. 0 failed.
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
                         │  Per-step audit log               │
                         └──────────────┬──────────────────┘
                                        │
                                 DevRev org ready
```

1. **Describe** what you need in plain English — or hand Dia a blueprint JSON.
2. **Review** the generated blueprint and plan before anything touches DevRev.
3. **Apply** — Dia creates parts, tickets, articles, accounts, contacts, links, and timeline entries via the DevRev REST API.
4. **Cleanup** — when the demo is over, Dia deletes everything she created in the correct reverse-dependency order.

---

## Quickstart

```bash
# Install
git clone <repo-url> && cd devrev-impl-agent
npm install && npm run build && npm link

# Configure
cp .env.example .env
# Add your DEVREV_PAT and ANTHROPIC_API_KEY to .env

# Check your setup
dia doctor

# Plan a POC from natural language
dia plan "SaaS support POC for Acme with auth, billing, and integrations capabilities"

# Review the plan, then apply
dia apply

# When you're done, clean up
dia cleanup
```

> **Screenshot opportunity: `dia doctor` output**
>
> Capture the terminal after running `dia doctor` — it shows PAT validation, user identity, role check, Anthropic key status, and MCP connectivity. This is the "ready to go" confirmation.

---

## Configuration

Copy [.env.example](.env.example) to `.env` or export variables directly:

| Variable | Required for | Description |
|----------|-------------|-------------|
| `DEVREV_PAT` | All commands except `generate` | Personal access token — [DevRev auth docs](https://developer.devrev.ai/about/authentication) |
| `ANTHROPIC_API_KEY` | `plan`, `start` (NL synthesis) | Powers the Claude planner |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-4-6` |
| `DEVREV_BETA` | Optional | Set to `1` for `X-Devrev-Scope: beta` |
| `DEVREV_MCP_COMMAND` | Optional | Custom MCP server command (default: `dia mcp-serve`) |
| `DEVREV_MCP_ARGS` | Optional | Args for the MCP command (default: `mcp-serve`) |

**Never** commit tokens or paste them into plans/logs. Dia redacts sensitive values in all audit output.

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

> **Screenshot opportunity: `dia plan` terminal output**
>
> Shows the Claude planner working (lookup_org calls, blueprint synthesis progress spinner), followed by the plan summary with step count, hierarchy validation, and any blueprint warnings.

### `dia apply` — execute the plan against DevRev

```bash
dia apply                          # uses ./poc-output/plan.json
dia apply -o ./my-migration        # specify output directory
dia apply --dry-run                # preview without mutations
dia apply --resume                 # pick up where a failed run left off
dia apply --json                   # machine-readable summary
```

Dia creates objects in dependency order (parts first, then articles, works, accounts, contacts, links, timeline entries). Each step is logged to an audit trail. If something fails midway, `--resume` skips completed steps and retries from the failure point.

> **Screenshot opportunity: `dia apply` execution**
>
> Capture the terminal showing the execution summary — e.g., `Execution summary: { ok: 60, failed: 0, skipped: 0, failures: [] }`. Bonus: show the DevRev UI with the created parts hierarchy visible.

### `dia cleanup` — reset the org after a demo

```bash
dia cleanup -o ./my-migration              # delete everything Dia created
dia cleanup -o ./my-migration --keep-parts # keep the product hierarchy, delete data
dia cleanup --dry-run                      # preview what would be deleted
```

Dia reads the manifest from a prior apply and deletes objects in reverse dependency order: timeline entries, links, works, articles, contacts, rev_orgs, accounts, and finally parts (leaf-first: enhancement, feature, capability, product). Already-deleted objects are skipped gracefully.

> **Screenshot opportunity: `dia cleanup` output**
>
> Show the dry-run output listing each object, then the live run with checkmarks. The before/after in the DevRev UI is particularly compelling.

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

Validates the DevRev PAT, reports your user identity and role, checks for the Anthropic API key, and tests MCP connectivity. Run this before your first apply — Dia will warn if she can't confirm Admin role (required for integration installs and SLA setup).

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

Pre-built starting points for the two dominant displacement scenarios:

- **[`blueprints/freshdesk-migration.json`](blueprints/freshdesk-migration.json)** — Parallel-run setup with seeded KB articles, sample tickets, conversation threads, priority mapping, and Freshdesk Airsync steps. Validated 63/63.

- **[`blueprints/zendesk-migration.json`](blueprints/zendesk-migration.json)** — Adapted for Zendesk customers: Brand-to-Part mapping, Help Center article import, Zendesk Airsync steps. Validated 74/74.

Dia **auto-detects** Freshdesk and Zendesk CSV header signatures and applies the right column mapping automatically. Drop your real CSV exports next to the blueprint as additional `csv` entries.

---

## Screenshots to capture

For a compelling demo of Dia herself, capture these moments:

| # | What to screenshot | Why it matters |
|---|-------------------|---------------|
| 1 | **`dia doctor`** output | Shows the "pre-flight check" — PAT valid, user identity, role warning, MCP connected |
| 2 | **`dia plan "..."`** in progress | The Claude planner working — spinner, lookup_org calls, blueprint warnings |
| 3 | **`blueprint.json`** open in VS Code | The human-readable intermediate representation — parts hierarchy, tickets with priorities, SLA targets |
| 4 | **`dia apply`** execution summary | The money shot — `ok: 60, failed: 0` |
| 5 | **DevRev UI — parts tree** after apply | Product, capabilities, features visible in the hierarchy |
| 6 | **DevRev UI — tickets list** after apply | Tickets with severity labels, assigned to parts, with conversation threads |
| 7 | **DevRev UI — KB articles** after apply | Articles created and associated with parts |
| 8 | **Plan's UI guidance section** | The rendered SLA targets, Slack setup playbook, PLuG deployment steps |
| 9 | **`dia cleanup --dry-run`** | Shows the deletion preview with dependency ordering |
| 10 | **`dia cleanup`** execution | Checkmarks as each object is deleted, manifest emptied |
| 11 | **DevRev UI — empty org** after cleanup | The before/after comparison — org is clean again |

---

## Gotchas Dia handles for you

Lessons from production DevRev implementations, encoded as validations and guidance:

- **RevUser/RevOrg mismatch** — Dia warns when rev_users lack a rev_org assignment. Without it, DevRev silently drops the reporter field on tickets.
- **Duplicate part names** — Dia checks the live org for naming collisions before creating parts.
- **Ticket/issue priority split** — Tickets use `severity` (string), issues use `priority_v2` (numeric). Dia handles the conversion transparently.
- **Link type constraints** — `is_dependent_on` only works for ticket-to-issue links. Same-type links must use `is_related_to`. Dia falls back automatically when the API rejects a link type.
- **Article API limitation** — DevRev articles don't support inline body content via API. Dia creates articles with title + optional URL resource; body content goes through the UI.
- **Slack: one connection per org** — Enterprise Slack accounts need DevRev Support whitelisting. Dia's Slack integration guide flags this.
- **Email sender defaults** — Outbound emails default to the workspace name, not the agent. Dia's email channel guidance covers the fix.
- **Admin role required** — `dia doctor` warns when it can't confirm Admin, which is required for integration installs and SLA configuration.

---

## Troubleshooting

### `links.create` HTTP 400

Usually an invalid `(link_type, source, target)` combo. Dia handles the common cases automatically:
- Ticket-to-issue with `is_related_to` → retries with `is_dependent_on`
- Same-type with `is_dependent_on` → retries with `is_related_to`

### `works.create` HTTP 409

The `external_ref` already exists from a previous apply. Dia reuses the existing work and updates the manifest. Reruns are safe.

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

## Development

```bash
npm install
npm run build        # tsup → dist/cli.js
npm run dev          # tsx (no build step)
npm test             # vitest (92 tests)
npm run lint         # eslint
```

## License

MIT
