import { describe, expect, it } from "vitest";
import { generateCsv, generateRows } from "./index.js";

describe("data generators", () => {
  it("are deterministic with the same seed", () => {
    const a = generateCsv({ scenario: "saas-support", entity: "contacts", count: 5, seed: 42 });
    const b = generateCsv({ scenario: "saas-support", entity: "contacts", count: 5, seed: 42 });
    expect(a).toBe(b);
  });

  it("differ across seeds", () => {
    const a = generateCsv({ scenario: "saas-support", entity: "contacts", count: 5, seed: 1 });
    const b = generateCsv({ scenario: "saas-support", entity: "contacts", count: 5, seed: 2 });
    expect(a).not.toBe(b);
  });

  it("emit logical column names matching mapRowHeaders aliases", () => {
    const rows = generateRows({ scenario: "saas-support", entity: "contacts", count: 1, seed: 1 });
    const r = rows[0];
    expect(r.display_name).toBeDefined();
    expect(r.email).toMatch(/@/);
    expect(r.external_ref).toBe(r.email);
  });

  it("supports all entity kinds", () => {
    for (const entity of ["contacts", "accounts", "tickets", "issues"] as const) {
      const csv = generateCsv({ scenario: "saas-support", entity, count: 2, seed: 7 });
      expect(csv.split("\n").length).toBeGreaterThan(2);
    }
  });

  it("seeded calls do not poison subsequent unseeded calls", () => {
    // Regression: fakerFor() used to mutate the global faker singleton when
    // seeded, so unseeded calls right after produced "the rest of the seeded
    // sequence" instead of fresh randomness.
    generateRows({ scenario: "saas-support", entity: "contacts", count: 3, seed: 99 });
    const a = generateRows({ scenario: "saas-support", entity: "contacts", count: 3 });
    const b = generateRows({ scenario: "saas-support", entity: "contacts", count: 3 });
    // Two unseeded calls should produce different rows.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
