import { describe, expect, it } from "vitest";
import { buildPlanFromBlueprint, type CsvImport } from "./buildFromBlueprint.js";

describe("buildPlanFromBlueprint — applies_to_part fallback", () => {
  it("round-robins generated tickets across blueprint leaf parts when row + defaults are absent", async () => {
    const csvImports: CsvImport[] = [
      {
        source_path: "test:tickets",
        entity: "tickets",
        rows: [{ title: "T1" }, { title: "T2" }, { title: "T3" }],
      },
    ];
    const result = await buildPlanFromBlueprint(
      {
        parts: [
          { ref: "prod:p", type: "product", name: "P" },
          { ref: "cap:c", type: "capability", name: "C", parent_ref: "prod:p" },
          { ref: "feat:a", type: "feature", name: "A", parent_ref: "cap:c" },
          { ref: "feat:b", type: "feature", name: "B", parent_ref: "cap:c" },
        ],
      },
      csvImports,
    );
    const ticketSteps = result.plan.steps.filter((s) => s.kind === "create_work");
    const partRefs = ticketSteps.map((s) => {
      const body = (s.payload?.body ?? {}) as Record<string, unknown>;
      const part = body.applies_to_part as { __ref?: string } | undefined;
      return part?.__ref;
    });
    expect(partRefs).toEqual(["feat:a", "feat:b", "feat:a"]);
  });

  it("respects an explicit defaults.applies_to_part over auto-rotation", async () => {
    const csvImports: CsvImport[] = [
      {
        source_path: "test:tickets",
        entity: "tickets",
        rows: [{ title: "T1" }, { title: "T2" }],
      },
    ];
    const result = await buildPlanFromBlueprint(
      {
        defaults: { applies_to_part: "PROD-EXPLICIT" },
        parts: [
          { ref: "prod:p", type: "product", name: "P" },
          { ref: "cap:c", type: "capability", name: "C", parent_ref: "prod:p" },
          { ref: "feat:a", type: "feature", name: "A", parent_ref: "cap:c" },
        ],
      },
      csvImports,
    );
    const ticketSteps = result.plan.steps.filter((s) => s.kind === "create_work");
    for (const s of ticketSteps) {
      const body = (s.payload?.body ?? {}) as Record<string, unknown>;
      expect(body.applies_to_part).toBe("PROD-EXPLICIT");
    }
  });

  it("leaves applies_to_part undefined when no parts and no defaults exist", async () => {
    const csvImports: CsvImport[] = [
      {
        source_path: "test:tickets",
        entity: "tickets",
        rows: [{ title: "T1" }],
      },
    ];
    const result = await buildPlanFromBlueprint({}, csvImports);
    const ticketSteps = result.plan.steps.filter((s) => s.kind === "create_work");
    const body = (ticketSteps[0].payload?.body ?? {}) as Record<string, unknown>;
    expect(body.applies_to_part).toBeUndefined();
  });
});
