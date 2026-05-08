import { describe, expect, it } from "vitest";
import { generateContacts } from "./generators/contacts.js";
import { saasSupport } from "./scenarios/saas-support.js";

describe("contact generator account grouping", () => {
  it("groups roughly 3 contacts per company", () => {
    const rows = generateContacts(saasSupport, 9, 1);
    const distinct = new Set(rows.map((r) => r.account_name));
    expect(distinct.size).toBe(3);
  });

  it("rounds up when count is not divisible by 3", () => {
    const rows = generateContacts(saasSupport, 10, 1);
    const distinct = new Set(rows.map((r) => r.account_name));
    expect(distinct.size).toBe(4); // ceil(10/3) === 4
  });

  it("never produces zero accounts for non-zero contacts", () => {
    const rows = generateContacts(saasSupport, 1, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].account_name).toBeDefined();
  });

  it("contacts in the same account share an email domain", () => {
    const rows = generateContacts(saasSupport, 6, 7);
    const byAccount = new Map<string, string[]>();
    for (const r of rows) {
      const list = byAccount.get(r.account_name) ?? [];
      list.push(r.email);
      byAccount.set(r.account_name, list);
    }
    for (const emails of byAccount.values()) {
      const domains = new Set(emails.map((e) => e.split("@")[1]));
      expect(domains.size).toBe(1);
    }
  });
});
