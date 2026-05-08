import { describe, expect, it } from "vitest";
import { buildPlanFromBlueprint, type CsvImport } from "./buildFromBlueprint.js";

describe("works.create priority/severity field selection", () => {
  it("tickets get severity (string), not priority_v2", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      works: [
        {
          ref: "tic:1",
          type: "ticket",
          title: "T",
          applies_to_part_ref: "prod:p",
          priority: "p1",
        },
      ],
    });
    const step = result.plan.steps.find((s) => s.kind === "create_work")!;
    const body = (step.payload?.body ?? {}) as Record<string, unknown>;
    expect(body.severity).toBe("high");
    expect(body.priority_v2).toBeUndefined();
    expect(body.priority).toBeUndefined();
  });

  it("issues get priority_v2 (numeric), not severity", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      works: [
        {
          ref: "iss:1",
          type: "issue",
          title: "I",
          applies_to_part_ref: "prod:p",
          priority: "p0",
        },
      ],
    });
    const step = result.plan.steps.find((s) => s.kind === "create_work")!;
    const body = (step.payload?.body ?? {}) as Record<string, unknown>;
    expect(body.priority_v2).toBe(1);
    expect(body.severity).toBeUndefined();
    expect(body.priority).toBeUndefined();
  });

  it("maps every priority bucket correctly for tickets", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      works: (["p0", "p1", "p2", "p3"] as const).map((p, i) => ({
        ref: `tic:${i}`,
        type: "ticket" as const,
        title: `T${i}`,
        applies_to_part_ref: "prod:p",
        priority: p,
      })),
    });
    const sevs = result.plan.steps
      .filter((s) => s.kind === "create_work")
      .map((s) => ((s.payload?.body ?? {}) as Record<string, unknown>).severity);
    expect(sevs).toEqual(["blocker", "high", "medium", "low"]);
  });

  it("maps every priority bucket correctly for issues", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      works: (["p0", "p1", "p2", "p3"] as const).map((p, i) => ({
        ref: `iss:${i}`,
        type: "issue" as const,
        title: `I${i}`,
        applies_to_part_ref: "prod:p",
        priority: p,
      })),
    });
    const v2s = result.plan.steps
      .filter((s) => s.kind === "create_work")
      .map((s) => ((s.payload?.body ?? {}) as Record<string, unknown>).priority_v2);
    expect(v2s).toEqual([1, 2, 3, 4]);
  });

  it("CSV-imported tickets get severity from the row's priority column", async () => {
    const csvImports: CsvImport[] = [
      {
        source_path: "test:tickets",
        entity: "tickets",
        rows: [{ title: "T1", priority: "p0" }, { title: "T2", priority: "p3" }],
      },
    ];
    const result = await buildPlanFromBlueprint(
      { parts: [{ ref: "prod:p", type: "product", name: "P" }] },
      csvImports,
    );
    const sevs = result.plan.steps
      .filter((s) => s.kind === "create_work")
      .map((s) => ((s.payload?.body ?? {}) as Record<string, unknown>).severity);
    expect(sevs).toEqual(["blocker", "low"]);
  });

  it("emits no priority field when the work has no priority set", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      works: [
        { ref: "tic:1", type: "ticket", title: "T", applies_to_part_ref: "prod:p" },
        { ref: "iss:1", type: "issue", title: "I", applies_to_part_ref: "prod:p" },
      ],
    });
    for (const step of result.plan.steps.filter((s) => s.kind === "create_work")) {
      const body = (step.payload?.body ?? {}) as Record<string, unknown>;
      expect(body.severity).toBeUndefined();
      expect(body.priority_v2).toBeUndefined();
    }
  });
});

describe("parts.create body shape", () => {
  it("emits parent_part as a single ref object, not an array", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "cap:c", type: "capability", name: "C", parent_ref: "prod:p" },
      ],
    });
    const capStep = result.plan.steps.find(
      (s) => s.kind === "create_part" && s.title.startsWith("Create capability"),
    )!;
    const body = (capStep.payload?.body ?? {}) as Record<string, unknown>;
    // Must be the scalar { __ref: "prod:p" }, not [{ __ref: "prod:p" }].
    expect(Array.isArray(body.parent_part)).toBe(false);
    expect(body.parent_part).toEqual({ __ref: "prod:p" });
  });
});

describe("articles.create body shape", () => {
  it("sends the API-confirmed minimum (title, owned_by, resource: {}) when no resource_url", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      articles: [
        {
          ref: "art:1",
          title: "How to reset your password",
          body: "This should be preserved in the blueprint but stripped from the API call.",
          applies_to_part_ref: "prod:p",
          status: "published",
          language: "en",
          external_ref: "should-be-stripped",
        },
      ],
    });
    const step = result.plan.steps.find((s) => s.kind === "create_article")!;
    const body = (step.payload?.body ?? {}) as Record<string, unknown>;
    expect(body.title).toBe("How to reset your password");
    expect(body.owned_by).toEqual(["SELF"]);
    expect(body.resource).toEqual({});
    // None of these reach the API — stripped to avoid invalid_field 400s.
    expect(body.body).toBeUndefined();
    expect(body.description).toBeUndefined();
    expect(body.external_ref).toBeUndefined();
    expect(body.applies_to_part).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(body.language).toBeUndefined();
  });

  it("sends resource: { url } when resource_url is set", async () => {
    const result = await buildPlanFromBlueprint({
      parts: [{ ref: "prod:p", type: "product", name: "P" }],
      articles: [
        {
          ref: "art:url",
          title: "Hosted in Confluence",
          resource_url: "https://kb.example.com/sso-okta",
          applies_to_part_ref: "prod:p",
        },
      ],
    });
    const step = result.plan.steps.find((s) => s.kind === "create_article")!;
    const body = (step.payload?.body ?? {}) as Record<string, unknown>;
    expect(body.resource).toEqual({ url: "https://kb.example.com/sso-okta" });
  });

  it("CSV-imported articles pick up resource_url / url columns", async () => {
    const result = await buildPlanFromBlueprint(
      { parts: [{ ref: "prod:p", type: "product", name: "P" }] },
      [
        {
          source_path: "test:articles",
          entity: "articles",
          rows: [
            { title: "URL article", resource_url: "https://docs.example.com/a" },
            { title: "Empty article" },
          ],
        },
      ],
    );
    const articleSteps = result.plan.steps.filter((s) => s.kind === "create_article");
    expect((articleSteps[0].payload?.body as Record<string, unknown>).resource).toEqual({
      url: "https://docs.example.com/a",
    });
    expect((articleSteps[1].payload?.body as Record<string, unknown>).resource).toEqual({});
  });
});
