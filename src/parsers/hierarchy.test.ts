import { describe, expect, it } from "vitest";
import { validateBlueprintRefs } from "./blueprint.js";

describe("parts-hierarchy validation", () => {
  it("accepts a valid product → capability → feature → enhancement chain", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "cap:c", type: "capability", name: "C", parent_ref: "prod:p" },
        { ref: "feat:f", type: "feature", name: "F", parent_ref: "cap:c" },
        { ref: "enh:e", type: "enhancement", name: "E", parent_ref: "feat:f" },
      ],
    });
    expect(issues).toEqual([]);
  });

  it("rejects a feature parented to a product directly", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "feat:f", type: "feature", name: "F", parent_ref: "prod:p" },
      ],
    });
    const broken = issues.find((i) => i.path.startsWith("parts[1]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain("feature");
    expect(broken?.message).toContain("capability");
  });

  it("rejects a capability parented to anything other than a product", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "cap:c1", type: "capability", name: "C1", parent_ref: "prod:p" },
        { ref: "cap:c2", type: "capability", name: "C2", parent_ref: "cap:c1" },
      ],
    });
    const broken = issues.find(
      (i) => i.path.startsWith("parts[2]") && i.message.includes("capability"),
    );
    expect(broken).toBeDefined();
  });

  it("rejects an enhancement parented to a product", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "enh:e", type: "enhancement", name: "E", parent_ref: "prod:p" },
      ],
    });
    const broken = issues.find((i) => i.path.startsWith("parts[1]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain("enhancement");
  });

  it("accepts an enhancement under either a capability or a feature", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:p", type: "product", name: "P" },
        { ref: "cap:c", type: "capability", name: "C", parent_ref: "prod:p" },
        { ref: "feat:f", type: "feature", name: "F", parent_ref: "cap:c" },
        { ref: "enh:on-cap", type: "enhancement", name: "OC", parent_ref: "cap:c" },
        { ref: "enh:on-feat", type: "enhancement", name: "OF", parent_ref: "feat:f" },
      ],
    });
    expect(issues).toEqual([]);
  });

  it("rejects a non-product part missing parent_ref", () => {
    const issues = validateBlueprintRefs({
      parts: [{ ref: "cap:c", type: "capability", name: "C" }],
    });
    const broken = issues.find((i) => i.path.startsWith("parts[0]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain("parent_ref");
  });

  it("rejects a product that has a parent_ref", () => {
    const issues = validateBlueprintRefs({
      parts: [
        { ref: "prod:a", type: "product", name: "A" },
        { ref: "prod:b", type: "product", name: "B", parent_ref: "prod:a" },
      ],
    });
    const broken = issues.find((i) => i.path.startsWith("parts[1]"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain("top-level");
  });
});
