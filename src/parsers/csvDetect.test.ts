import { describe, expect, it } from "vitest";
import { detectSourceSystem } from "./csv.js";

describe("CSV source-system detection", () => {
  it("identifies Freshdesk exports by signature columns", () => {
    expect(
      detectSourceSystem(["Ticket ID", "Subject", "Requester Name", "Agent Name", "Priority Name"]),
    ).toBe("freshdesk");
  });

  it("identifies Zendesk exports by signature columns", () => {
    expect(
      detectSourceSystem(["id", "subject", "requester", "assignee", "group", "priority"]),
    ).toBe("zendesk");
  });

  it("identifies Jira exports by signature columns", () => {
    expect(
      detectSourceSystem(["Issue key", "Issue Type", "Summary", "Assignee", "Reporter", "Priority", "Status"]),
    ).toBe("jira");
  });

  it("returns 'unknown' for arbitrary CSVs", () => {
    expect(detectSourceSystem(["Name", "Email", "Phone"])).toBe("unknown");
    expect(detectSourceSystem([])).toBe("unknown");
  });

  it("does not falsely classify CSVs that share a single signature word", () => {
    // Has "id" but not the rest of the Zendesk fingerprint.
    expect(detectSourceSystem(["id", "name"])).toBe("unknown");
    // Has "Ticket ID" but no requester/agent → not Freshdesk.
    expect(detectSourceSystem(["Ticket ID", "Subject"])).toBe("unknown");
  });
});
