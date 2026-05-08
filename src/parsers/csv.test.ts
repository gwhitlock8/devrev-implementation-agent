import { describe, expect, it } from "vitest";
import { mapRowHeaders } from "./csv.js";

describe("mapRowHeaders", () => {
  it("maps aliases and custom column_map", () => {
    const row = { Name: "Ada", Email: "ada@example.com", Company: "ExampleCo" };
    const mapped = mapRowHeaders(row, { Company: "account_name" });
    expect(mapped.display_name).toBe("Ada");
    expect(mapped.email).toBe("ada@example.com");
    expect(mapped.account_name).toBe("ExampleCo");
  });
});
