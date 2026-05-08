# Usage guide

## Pipeline

```
NL brief ── Claude ──► blueprint.json ── deterministic ──► plan.json ── DevRev REST ──► org
                          ▲                                                                 │
                          └──── lookup_org via DevRev MCP ──── verify against manifest ◄────┘
```

`start` runs the whole pipeline end-to-end. `plan` and `apply` let you stop and inspect between phases. `generate` produces standalone CSVs. `verify` checks post-apply state via the DevRev MCP.

## Blueprint JSON

| Field                    | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `name`, `description`    | Plan title/summary                                                          |
| `defaults.owned_by`      | Default owners; `["SELF"]` resolves to the authenticated dev user           |
| `defaults.rev_org`       | Default workspace id/display id for imported contacts                      |
| `defaults.applies_to_part` | Default product/part for CSV tickets/issues                              |
| `parts[]`                | Product hierarchy (`product`, `capability`, `feature`, `enhancement`, …)   |
| `works[]`                | Issues/tickets/tasks/opportunities (`works.create`)                        |
| `incidents[]`            | Incidents (`incidents.create`)                                              |
| `links[]`                | `links.create` between blueprint refs                                       |
| `accounts[]`             | `accounts.create`                                                           |
| `account_updates[]`      | `accounts.update`                                                           |
| `rev_users[]`            | `rev-users.create`                                                          |
| `rev_user_updates[]`     | `rev-users.update`                                                          |
| `articles[]`             | KB articles (`articles.create`)                                             |
| `timeline_entries[]`     | Explicit comments on works (`timeline-entries.create`)                      |
| `generate_conversations` | Auto-generate timeline entries across all works using a scenario            |
| `rev_orgs[]`             | Customer workspaces (`rev-orgs.create`); supports `account_ref`            |
| `sla_policies[]`         | SLA targets (UI-only — rendered into the plan's UI guidance)               |
| `email_channels[]`       | Inbound email channels with keyword routing (UI-only)                      |
| `plug_config`            | PLuG widget config + AI grounding hints (UI-only)                          |
| `integrations[]`         | Integration setup playbooks (Slack, Jira, SFDC, Freshdesk, HubSpot, …)     |
| `csv[]`                  | CSV bindings — see below                                                    |
| `ui_guidance[]`          | Becomes `ui_guidance_sections` in the plan                                  |
| `options.include_sprint_discovery` | Adds a read-only `list_sprints` step                              |

Use `ref` on blueprint objects to wire **`manifest_ref`** resolution for later steps (links, parent parts, account associations, etc.). Refs are validated at plan time — broken refs fail before any DevRev call.

## CSV bindings

Two flavors:

**Pre-existing CSV**:

```json
{
  "csv": [
    { "path": "./contacts.csv", "entity": "contacts", "column_map": { "Email": "email" } }
  ]
}
```

**Faker generator**:

```json
{
  "csv": [
    { "generator": "faker", "scenario": "saas-support", "entity": "tickets", "count": 50, "seed": 42 }
  ]
}
```

Generators write resolved CSVs into `<output-dir>/generated/<entity>.csv` so you have a record of the exact data the run was based on. Same `seed` → identical output.

Entities:

- **contacts** → `rev-users.create` rows (needs `rev_org` via defaults or column).
- **accounts** → `accounts.create`.
- **tickets** / **issues** → `works.create` with appropriate `type`.
- **articles** → `articles.create`. Logical columns: `title`, `body`, `status`, `language`, `external_ref`.

Headers are normalized (`Display Name` → `display_name`, `Subject` → `title`, `Company` → `account_name`, etc.). The agent **auto-detects Freshdesk and Zendesk** export headers and applies the corresponding alias map automatically (logged to stderr when triggered). Override with `column_map`.

### Migration blueprints

`blueprints/freshdesk-migration.json` and `blueprints/zendesk-migration.json` are pre-built templates for the two dominant displacement scenarios. Each ships with:

- A parts hierarchy that mirrors the source system's product/brand structure.
- Seeded KB articles + 15-20 generated tickets + auto-generated 2-comment threads per ticket.
- `ui_guidance` sections covering priority/severity mapping, SLA recreation, and (Freshdesk) Airsync setup for parallel-run.

Drop your customer's real export CSVs next to the blueprint and add `{ "path": "./fd-tickets.csv", "entity": "tickets" }` to the `csv` array. Auto-detection handles the column mapping.

### Configuration primitives (SLA, email, PLuG, integrations)

DevRev exposes most of these only through the UI, so the agent's value isn't direct API automation — it's a tight, accurate playbook the SE can follow without inventing menu paths.

```json
"sla_policies": [
  {
    "name": "Enterprise",
    "applies_to": "Enterprise tier accounts",
    "targets": {
      "first_response": { "p0": "1 hour", "p1": "4 hours", "p2": "8 hours", "p3": "24 hours" },
      "resolution":     { "p0": "4 hours", "p1": "24 hours", "p2": "72 hours", "p3": "1 week" }
    },
    "escalation": "Auto-escalate at 80% of target"
  }
],
"email_channels": [
  {
    "address": "support@acme.com",
    "keyword_routing": [
      { "keyword": "billing", "route_to": "feat:invoices" },
      { "keyword": "outage",  "route_to": "feat:reliability" }
    ]
  }
],
"plug_config": {
  "welcome_message": "Hi! Ask me anything or open a ticket.",
  "primary_color": "#3B82F6",
  "ai_agent_enabled": true,
  "fallback_to_ticket": true
},
"integrations": ["slack", "jira", { "name": "salesforce", "notes": "Account is master in SFDC" }]
```

Each block becomes a structured `ui_guidance_sections` entry in the emitted plan. The PLuG block automatically references the seeded `articles[]` as AI-agent grounding sources.

### Multi-tenant: `rev_orgs[]`

```json
"rev_orgs": [
  { "ref": "revorg:acme-prod", "display_name": "Acme — Production", "account_ref": "acct:acme" },
  { "ref": "revorg:acme-staging", "display_name": "Acme — Staging", "account_ref": "acct:acme" }
],
"rev_users": [
  { "ref": "ru:ada", "email": "ada@acme.com", "display_name": "Ada", "rev_org_ref": "revorg:acme-prod", "account_ref": "acct:acme" }
]
```

Plan ordering: accounts → rev_orgs → rev_users, so `rev_org_ref` and `account_ref` resolve cleanly.

### Articles & conversations

KB articles are first-class blueprint primitives. The plan builder emits `create_article` steps after parts (articles need a part to attach to) and before works.

For realistic ticket threads, declare:

```json
"generate_conversations": {
  "scenario": "saas-support",
  "per_ticket": 2,
  "seed": 42
}
```

The plan builder will append `create_timeline_entry` steps for every blueprint + CSV-imported ticket, alternating customer/agent voice. `for_first_n_tickets` caps it to the first N if you only want to thread a sample.

## Standalone data generation

```bash
devrev-impl-agent generate saas-support --entity tickets --rows 50 --seed 42 -o tickets.csv
```

| Scenario       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `saas-support` | B2B SaaS product, support team triaging customer tickets |
| `b2b-sales`    | B2B pipeline, multi-contact accounts, renewal tickets    |
| `dev-tooling`  | Engineering team using DevRev for issues/sprints         |

## Plans (`plan.json`)

Plans conform to version `1` with:

- `steps[]`: machine steps (`create_part`, `create_work`, `create_incident`, `create_link`, `create_account`, `create_rev_user`, `update_*`, `list_sprints`, `noop`, `ui_guidance`).
- `ui_guidance_sections[]`: numbered manual instructions referencing DevRev docs.

## Execution artifacts

Inside `--output-dir` (default `./poc-output`):

| File                         | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `blueprint.json`             | Synthesized (or hand-edited) blueprint                 |
| `generated/<entity>.csv`     | Faker output when blueprint declared a generator       |
| `plan.json`                  | Frozen plan from `plan` / `start`                      |
| `implementation-log.ndjson`  | Structured entries (redacted), one JSON object per line |
| `implementation-report.md`   | Human-readable companion                               |
| `run-manifest.json`          | Maps blueprint `ref` → DevRev ids/display ids          |

## Resuming a partial apply

`run-manifest.json` carries two sections: `refs` (created object → DevRev id) and `completed` (set of step ids that finished successfully). When `apply --resume` runs, it skips any step whose id is in `completed`. Useful when a transient failure halts a run partway — fix the issue and re-run with `--resume` instead of starting over.

## Idempotent `works.create`

If a step includes **`external_ref`**, the executor calls **`works.list`** first and **reuses** an existing work with that ref instead of creating a duplicate. If **`works.create`** returns **HTTP 409 Conflict**, it looks up the work again and **refreshes `run-manifest.json`** so later link steps still resolve `tic:*` / `iss:*` refs.

## Links (`links.create`)

DevRev **default link types** restrict which `(source_type, target_type, relationship)` combinations are valid. The agent:

- Warns at plan time when a `ticket`↔`issue` link uses `is_related_to`.
- Retries those at apply time as `is_dependent_on` if the first call returns 400.
- Treats 409 / duplicate errors as no-op success.

For full fidelity, list link types with `POST https://api.devrev.ai/link-types.custom.list` and use the matching **`custom_link_type`** id (recommended by DevRev for new integrations). See [Links guide](https://developer.devrev.ai/beta/guides/links).

## Progress feedback

`plan` and `start` emit live status to stderr while the LLM synthesizes the blueprint. Events surfaced:

- Turn counter (`Synthesizing blueprint with Claude (turn 2)`) — each turn is one Claude API call.
- `lookup_org` invocations (`→ lookup_org("Acme")`) — see what the planner is asking the live org about.
- Schema-validation retries when Claude submits a malformed blueprint.
- Plan build + step count (`✓ Plan built (24 steps)`).

The spinner auto-disables in non-TTY environments. Stdout stays clean — only the plan/blueprint summary goes there — so you can safely pipe `dia plan "..." > out.txt`.

## DevRev MCP integration

The agent uses the DevRev MCP server (the live-org one — not the AirSync mapping MCP) for two things:

1. **During planning**: Claude has a `lookup_org` tool that calls the MCP `search`/`get_object` endpoints. It uses this to ground decisions in real org state — e.g. spotting that an account named "Acme" already exists and reusing its display id instead of recreating.
2. **`verify` command**: After apply, walks `run-manifest.json` and confirms each entry exists in the org.

The MCP command is configurable via `DEVREV_MCP_COMMAND` / `DEVREV_MCP_ARGS`. Default: `npx -y @devrev/mcp`. The MCP subprocess inherits `DEVREV_PAT`. Without MCP installed, planning still works (skips `lookup_org`) but `verify` is unavailable.

## Sprint discovery limitation

There is no documented public **`sprints.list`** endpoint. The `list_sprints` step calls **`works.list`** (POST) and **aggregates sprint objects attached to returned work items**, so sprints with zero issues may not appear.

## Permissions / PAT scopes

Contacts require appropriate scopes (e.g. `rev_user:write` on `rev-users.create`). If DevRev returns HTTP 403, regenerate a PAT with sufficient privileges.

## OpenAPI spec

If you need to audit endpoint names locally, download DevRev's OpenAPI export from the developer portal and follow [scripts/openapi-note.md](../scripts/openapi-note.md).
