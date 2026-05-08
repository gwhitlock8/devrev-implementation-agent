import type { Scenario } from "./types.js";

export const devTooling: Scenario = {
  name: "dev-tooling",
  description: "Engineering team using DevRev for issue tracking, sprints, and a parts hierarchy.",
  companySuffixes: ["Devs", "Engineering", "Studio", "Workshop", "Foundry", "Software"],
  emailDomainTemplate: "${slug}.dev",
  ticketTitles: [
    "Investigation: flaky CI on Linux runners",
    "Repro request: deploy fails for monorepo apps",
    "Trace request: latency spike at 14:30 UTC",
    "Build cache regression after upgrade",
    "Internal: feature flag stuck on for staging",
    "Internal: secret rotation broke worker pool",
  ],
  issueTitles: [
    "Stabilize Linux CI runners",
    "Fix monorepo app deploy regression",
    "Reduce p99 latency on /v1/query",
    "Restore build cache invalidation rules",
    "Add per-environment feature flag override",
    "Automate secret rotation rollback",
    "Add structured logging to worker pool",
    "Migrate scheduler off cron-based polling",
    "Audit dependency upgrade strategy",
  ],
  priorityWeights: ["p1", "p2", "p2", "p3", "p3", "p0"],
  articleTitles: [
    "Debugging flaky CI runs",
    "Build cache invalidation strategy",
    "Latency SLOs and how to investigate spikes",
    "Per-environment feature-flag overrides",
    "Secret rotation playbook",
    "Migrating from cron-based scheduling",
  ],
  conversations: [
    {
      customer: "CI on Linux runners has been flaky all week — failing roughly 1 in 3 runs with timeouts.",
      agent: "Tracking the same signal on our side. Looks correlated with a runner image bump that landed Tuesday. We're rolling back that image now and will re-cut runners over the next hour. Mind retrying after that?",
    },
    {
      customer: "Our monorepo deploy is failing for app A after an upgrade — others build fine.",
      agent: "Got it. The most common culprit there is a stale dependency lock for app A — can you confirm the lockfile generation timestamp matches the dep upgrade? I can also pull a build trace if you share the failed run id.",
    },
    {
      customer: "Saw a latency spike at 14:30 UTC on /v1/query — anything on your end?",
      agent: "Yes, that aligned with a brief incident on the upstream cache layer; full RCA in the status page postmortem. Tail latencies should be back to baseline now. Want me to pull a per-tenant graph for your account to confirm?",
    },
  ],
};
