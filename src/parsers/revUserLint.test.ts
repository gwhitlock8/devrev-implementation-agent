import { describe, expect, it } from "vitest";
import { lintRevUserRevOrg } from "./blueprint.js";

describe("lintRevUserRevOrg", () => {
  it("returns no issues when blueprint has no rev_users", () => {
    expect(lintRevUserRevOrg({})).toEqual([]);
  });

  it("warns when rev_users have no rev_org assignment and no defaults.rev_org", () => {
    const issues = lintRevUserRevOrg({
      rev_users: [
        { ref: "ru:1", email: "a@b.com", display_name: "A" },
        { ref: "ru:2", email: "c@d.com", display_name: "C" },
      ],
    });
    expect(issues.length).toBe(2);
    expect(issues[0].path).toBe("rev_users[0]");
    expect(issues[0].message).toContain("no rev_org assignment");
  });

  it("does not warn when defaults.rev_org is set", () => {
    const issues = lintRevUserRevOrg({
      defaults: { rev_org: "REVO-1" },
      rev_users: [{ ref: "ru:1", email: "a@b.com", display_name: "A" }],
    });
    expect(issues).toEqual([]);
  });

  it("does not warn when each rev_user sets its own rev_org_ref", () => {
    const issues = lintRevUserRevOrg({
      accounts: [{ ref: "acct:a", display_name: "A" }],
      rev_orgs: [{ ref: "ro:a", display_name: "A Prod", account_ref: "acct:a" }],
      rev_users: [
        { ref: "ru:1", email: "a@b.com", display_name: "A", rev_org_ref: "ro:a", account_ref: "acct:a" },
      ],
    });
    expect(issues).toEqual([]);
  });

  it("warns on cross-account membership (rev_user.account_ref != rev_org.account_ref)", () => {
    const issues = lintRevUserRevOrg({
      accounts: [
        { ref: "acct:a", display_name: "A" },
        { ref: "acct:b", display_name: "B" },
      ],
      rev_orgs: [{ ref: "ro:a", display_name: "A Prod", account_ref: "acct:a" }],
      rev_users: [
        {
          ref: "ru:wrong",
          email: "x@y.com",
          display_name: "X",
          rev_org_ref: "ro:a",
          account_ref: "acct:b",
        },
      ],
    });
    const broken = issues.find((i) => i.message.includes("does not match"));
    expect(broken).toBeDefined();
    expect(broken?.message).toContain("acct:a");
    expect(broken?.message).toContain("acct:b");
  });
});
