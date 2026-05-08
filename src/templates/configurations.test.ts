import { describe, expect, it } from "vitest";
import {
  emailChannelsGuidance,
  integrationsGuidance,
  plugGuidance,
  prerequisitesGuidance,
  slaGuidance,
  SUPPORTED_INTEGRATIONS,
} from "./configurations.js";

describe("slaGuidance", () => {
  it("renders one block per policy with priority targets in p0..p3 order", () => {
    const g = slaGuidance([
      {
        name: "Enterprise SLA",
        description: "For tagged enterprise accounts",
        applies_to: "Enterprise tier",
        targets: {
          first_response: { p0: "1 hour", p1: "4 hours", p2: "8 hours", p3: "24 hours" },
          resolution: { p0: "4 hours", p3: "1 week" },
        },
        escalation: "Auto-escalate at 80%",
      },
    ]);
    expect(g.title).toMatch(/SLA/);
    const text = g.steps.join("\n");
    expect(text).toContain("Enterprise SLA");
    expect(text).toContain("Enterprise tier");
    expect(text).toContain("p0 (blocker) ≤ 1 hour");
    expect(text).toContain("Auto-escalate at 80%");
    // Priorities must appear in p0,p1,p2,p3 order in the first-response line.
    const fr = g.steps.find((l) => l.includes("First-response"))!;
    expect(fr.indexOf("p0")).toBeLessThan(fr.indexOf("p1"));
    expect(fr.indexOf("p1")).toBeLessThan(fr.indexOf("p2"));
    expect(fr.indexOf("p2")).toBeLessThan(fr.indexOf("p3"));
  });

  it("omits empty target maps cleanly", () => {
    const g = slaGuidance([{ name: "Empty", targets: {} }]);
    const text = g.steps.join("\n");
    expect(text).toContain("Empty");
    expect(text).not.toMatch(/First-response: $/m);
  });
});

describe("emailChannelsGuidance", () => {
  it("emits keyword routing rules under each address", () => {
    const g = emailChannelsGuidance([
      {
        address: "support@acme.com",
        keyword_routing: [
          { keyword: "billing", route_to: "feat:billing" },
          { keyword: "outage", route_to: "feat:reliability" },
        ],
      },
    ]);
    const text = g.steps.join("\n");
    expect(text).toContain("support@acme.com");
    expect(text).toContain('"billing" → feat:billing');
    expect(text).toContain('"outage" → feat:reliability');
  });
});

describe("plugGuidance", () => {
  it("includes AI grounding cue when ai_agent_enabled is not false", () => {
    const g = plugGuidance({ welcome_message: "Hi!", ai_agent_enabled: true });
    const text = g.steps.join("\n");
    expect(text).toContain("Hi!");
    expect(text).toContain("Enable the AI agent");
    expect(text).toContain("KB articles");
  });

  it("skips AI cues when ai_agent_enabled is explicitly false", () => {
    const g = plugGuidance({ ai_agent_enabled: false });
    const text = g.steps.join("\n");
    expect(text).not.toContain("Enable the AI agent");
  });
});

describe("integrationsGuidance", () => {
  it("expands keys to canonical sections and accepts notes", () => {
    const out = integrationsGuidance(["slack", { name: "jira", notes: "sync to PROJ-X only" }]);
    expect(out.length).toBe(2);
    expect(out[0].title).toMatch(/Slack/);
    expect(out[1].title).toMatch(/Jira/);
    expect(out[1].steps.join("\n")).toContain("PROJ-X");
  });

  it("covers every integration declared in SUPPORTED_INTEGRATIONS", () => {
    const out = integrationsGuidance(SUPPORTED_INTEGRATIONS);
    expect(out.length).toBe(SUPPORTED_INTEGRATIONS.length);
    for (const section of out) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.steps.length).toBeGreaterThan(2);
    }
  });

  it("includes feature_request_handler", () => {
    expect(SUPPORTED_INTEGRATIONS).toContain("feature_request_handler");
    const out = integrationsGuidance(["feature_request_handler"]);
    expect(out[0].title).toMatch(/Feature Request Handler/);
    expect(out[0].steps.join("\n")).toMatch(/snap-in/i);
  });

  it("Slack template flags the 1-public-connection limit and Enterprise whitelisting", () => {
    const [slack] = integrationsGuidance(["slack"]);
    const text = slack.steps.join("\n");
    expect(text).toMatch(/Only ONE public Slack connection/i);
    expect(text).toMatch(/Enterprise/);
  });
});

describe("prerequisitesGuidance", () => {
  it("calls out Admin role + PAT-creator equivalence + 403 retry guidance", () => {
    const g = prerequisitesGuidance();
    const text = g.steps.join("\n");
    expect(g.title).toMatch(/Prerequisites/);
    expect(text).toMatch(/Admin role/);
    expect(text).toMatch(/PAT/);
    expect(text).toMatch(/403/);
  });
});

describe("emailChannelsGuidance — outbound defaults", () => {
  it("flags the From-address default and suggests the sender-name toggle", () => {
    const g = emailChannelsGuidance([{ address: "support@acme.com" }]);
    const text = g.steps.join("\n");
    expect(text).toMatch(/'From' address is the workspace/);
    expect(text).toMatch(/use the name of the logged-in user as sender/);
    expect(text).toMatch(/Email Integration Bot/);
  });
});

describe("plugGuidance — federated-login note", () => {
  it("warns that the customer portal does not support SAML/OIDC", () => {
    const g = plugGuidance({});
    const text = g.steps.join("\n");
    expect(text).toMatch(/customer-portal auth limitation/i);
    expect(text).toMatch(/SAML/);
  });
});
