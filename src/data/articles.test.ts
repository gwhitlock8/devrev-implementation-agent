import { describe, expect, it } from "vitest";
import { generateArticles } from "./generators/articles.js";
import { generateConversations } from "./generators/conversations.js";
import { saasSupport } from "./scenarios/saas-support.js";

describe("article generator", () => {
  it("emits logical column names matching the article plan-step body", () => {
    const rows = generateArticles(saasSupport, 3, 7);
    for (const r of rows) {
      expect(r.title).toBeDefined();
      expect(r.body).toBeDefined();
      expect(r.body.length).toBeGreaterThan(40);
      expect(r.status).toBe("published");
      expect(r.language).toBe("en");
      expect(r.external_ref).toBeDefined();
    }
  });

  it("is deterministic with the same seed", () => {
    const a = generateArticles(saasSupport, 5, 42);
    const b = generateArticles(saasSupport, 5, 42);
    expect(a).toEqual(b);
  });

  it("cycles through the scenario's title bank", () => {
    const rows = generateArticles(saasSupport, saasSupport.articleTitles.length + 2, 1);
    expect(rows[0].title).toBe(saasSupport.articleTitles[0]);
    expect(rows[saasSupport.articleTitles.length].title).toBe(saasSupport.articleTitles[0]);
  });
});

describe("conversation generator", () => {
  it("alternates customer → agent across `per_ticket` entries", () => {
    const entries = generateConversations(saasSupport, ["tic:1"], 4, 7);
    expect(entries.length).toBe(4);
    expect(entries[0].object_ref).toBe("tic:1");
    // 0 and 2 should both come from the customer side of the same pair;
    // 1 and 3 from the agent side. Either way, alternation invariant: 0/2 share
    // body, 1/3 share body.
    expect(entries[0].body).toBe(entries[2].body);
    expect(entries[1].body).toBe(entries[3].body);
    expect(entries[0].body).not.toBe(entries[1].body);
  });

  it("attaches per_ticket entries to every supplied ref", () => {
    const refs = ["tic:1", "tic:2", "tic:3"];
    const entries = generateConversations(saasSupport, refs, 2, 7);
    expect(entries.length).toBe(refs.length * 2);
    expect(new Set(entries.map((e) => e.object_ref))).toEqual(new Set(refs));
  });

  it("is deterministic with the same seed", () => {
    const a = generateConversations(saasSupport, ["a", "b"], 2, 99);
    const b = generateConversations(saasSupport, ["a", "b"], 2, 99);
    expect(a).toEqual(b);
  });
});
