import { describe, expect, it } from "vitest";
import { buildPlanFromBlueprint } from "./buildFromBlueprint.js";

describe("plan builder — articles & conversations", () => {
  it("emits create_article steps after parts and before works", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      articles: [
        { ref: "kb:1", title: "FAQ 1", body: "Body 1", applies_to_part_ref: "prod:p" },
      ],
      works: [{ ref: "tkt:1", type: "ticket", title: "T", applies_to_part_ref: "prod:p" }],
    });
    const kinds = result.plan.steps.map((s) => s.kind);
    const partIdx = kinds.indexOf("create_part");
    const articleIdx = kinds.indexOf("create_article");
    const workIdx = kinds.indexOf("create_work");
    expect(partIdx).toBeGreaterThan(-1);
    expect(articleIdx).toBeGreaterThan(partIdx);
    expect(workIdx).toBeGreaterThan(articleIdx);
  });

  it("flags an article with an unknown applies_to_part_ref", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      articles: [{ title: "Bad", applies_to_part_ref: "nope" }],
    });
    const broken = result.refIssues.find((i) => i.path.startsWith("articles[0]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain('"nope"');
  });

  it("auto-generates timeline entries from generate_conversations across blueprint and CSV works", async () => {
    const result = await buildPlanFromBlueprint(
      {
        parts: [{ ref: "prod:p", type: "product", name: "P" }],
        works: [
          { ref: "tkt:1", type: "ticket", title: "T1", applies_to_part_ref: "prod:p" },
          { ref: "tkt:2", type: "ticket", title: "T2", applies_to_part_ref: "prod:p" },
        ],
        generate_conversations: { scenario: "saas-support", per_ticket: 2, seed: 1 },
      },
      [
        {
          source_path: "test:tickets",
          entity: "tickets",
          rows: [{ title: "CSV-1" }, { title: "CSV-2" }],
        },
      ],
    );
    const tlEntries = result.plan.steps.filter((s) => s.kind === "create_timeline_entry");
    // 4 work refs (2 blueprint + 2 csv) × 2 per_ticket = 8 entries.
    expect(tlEntries.length).toBe(8);
    const targetRefs = tlEntries.map((s) => {
      const body = (s.payload?.body ?? {}) as Record<string, unknown>;
      const obj = body.object as { __ref?: string } | undefined;
      return obj?.__ref;
    });
    expect(new Set(targetRefs)).toEqual(new Set(["tkt:1", "tkt:2", "csv:tic:1", "csv:tic:2"]));
  });

  it("flags a timeline_entry attached to an unknown work ref", async () => {
    const result = await buildPlanFromBlueprint({
      works: [{ ref: "tkt:1", type: "ticket", title: "T" }],
      timeline_entries: [{ object_ref: "tkt:ghost", body: "hello" }],
    });
    const broken = result.refIssues.find((i) => i.path.startsWith("timeline_entries"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain('"tkt:ghost"');
  });

  it("for_first_n_tickets caps the auto-generated entries", async () => {
    const result = await buildPlanFromBlueprint({
      works: [
        { ref: "tkt:1", type: "ticket", title: "T1" },
        { ref: "tkt:2", type: "ticket", title: "T2" },
        { ref: "tkt:3", type: "ticket", title: "T3" },
      ],
      generate_conversations: {
        scenario: "saas-support",
        per_ticket: 2,
        for_first_n_tickets: 2,
        seed: 1,
      },
    });
    const tlEntries = result.plan.steps.filter((s) => s.kind === "create_timeline_entry");
    // 2 tickets × 2 per_ticket = 4 entries, even though there are 3 tickets.
    expect(tlEntries.length).toBe(4);
  });
});
