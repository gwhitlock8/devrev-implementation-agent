import { describe, expect, it } from "vitest";
import { buildPlanFromBlueprint } from "./buildFromBlueprint.js";

describe("plan builder — Phase C-2 primitives", () => {
  it("emits create_rev_org steps after accounts and before rev_users", async () => {
    const result = await buildPlanFromBlueprint({
      accounts: [{ ref: "acct:acme", display_name: "Acme" }],
      rev_orgs: [
        { ref: "revorg:acme-prod", display_name: "Acme Prod", account_ref: "acct:acme" },
      ],
      rev_users: [
        {
          ref: "ru:ada",
          email: "ada@acme.com",
          display_name: "Ada",
          rev_org_ref: "revorg:acme-prod",
          account_ref: "acct:acme",
        },
      ],
    });
    expect(result.refIssues).toEqual([]);
    const kinds = result.plan.steps.map((s) => s.kind);
    const accIdx = kinds.indexOf("create_account");
    const orgIdx = kinds.indexOf("create_rev_org");
    const userIdx = kinds.indexOf("create_rev_user");
    expect(accIdx).toBeGreaterThan(-1);
    expect(orgIdx).toBeGreaterThan(accIdx);
    expect(userIdx).toBeGreaterThan(orgIdx);
  });

  it("flags rev_org with an unknown account_ref", async () => {
    const result = await buildPlanFromBlueprint({
      rev_orgs: [{ display_name: "Orphan", account_ref: "nope" }],
    });
    const broken = result.refIssues.find((i) => i.path.startsWith("rev_orgs[0]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain('"nope"');
  });

  it("flags rev_user with an unknown rev_org_ref", async () => {
    const result = await buildPlanFromBlueprint({
      rev_users: [
        { ref: "ru:x", email: "x@y", display_name: "X", rev_org_ref: "ghost" },
      ],
    });
    const broken = result.refIssues.find((i) => i.path.startsWith("rev_users[0].rev_org_ref"));
    expect(broken).toBeDefined();
  });

  it("translates sla_policies / email_channels / plug_config / integrations into ui_guidance_sections", async () => {
    const result = await buildPlanFromBlueprint({
      sla_policies: [
        {
          name: "Enterprise",
          targets: { first_response: { p0: "1 hour" } },
        },
      ],
      email_channels: [{ address: "support@acme.com" }],
      plug_config: { ai_agent_enabled: true, welcome_message: "Hi" },
      integrations: ["slack", { name: "jira", notes: "PROJ-X" }],
    });
    const sections = result.plan.ui_guidance_sections ?? [];
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SLA/),
        expect.stringMatching(/email/i),
        expect.stringMatching(/PLuG/),
        expect.stringMatching(/Slack/),
        expect.stringMatching(/Jira/),
      ]),
    );
    const jira = sections.find((s) => s.title.includes("Jira"))!;
    expect(jira.steps.join("\n")).toContain("PROJ-X");
  });

  it("prepends a Prerequisites section once when any C-2 primitive is set", async () => {
    const result = await buildPlanFromBlueprint({
      integrations: ["slack"],
    });
    const sections = result.plan.ui_guidance_sections ?? [];
    expect(sections[0]?.title).toMatch(/Prerequisites/);
    // Should appear at most once.
    const prereqMatches = sections.filter((s) => /Prerequisites/.test(s.title));
    expect(prereqMatches.length).toBe(1);
  });

  it("does NOT add a Prerequisites section when no C-2 primitive is set", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
    });
    const sections = result.plan.ui_guidance_sections ?? [];
    for (const s of sections) {
      expect(s.title).not.toMatch(/Prerequisites/);
    }
  });
});
