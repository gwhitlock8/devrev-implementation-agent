import { describe, expect, it } from "vitest";
import { redactDeep } from "./redact.js";

describe("redactDeep", () => {
  it("redacts the original token key set", () => {
    const r = redactDeep({
      authorization: "Bearer abc",
      pat: "DRP-xyz",
      token: "T",
      password: "p",
      secret: "s",
      api_key: "k",
      apikey: "k2",
      keep: "ok",
    }) as Record<string, unknown>;
    for (const k of ["authorization", "pat", "token", "password", "secret", "api_key", "apikey"]) {
      expect(r[k]).toBe("[REDACTED]");
    }
    expect(r.keep).toBe("ok");
  });

  it("redacts new token-key additions", () => {
    const r = redactDeep({
      bearer: "abc",
      credential: "x",
      credentials: "y",
      private_key: "pk",
      access_key: "ak",
      access_token: "at",
      refresh_token: "rt",
    }) as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      expect(r[k]).toBe("[REDACTED]");
    }
  });

  it("redacts PII keys with the [REDACTED:pii] sentinel", () => {
    const r = redactDeep({
      email: "ada@example.com",
      phone: "+15555550100",
      phone_numbers: ["+15555550100"],
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
      keep: "ok",
    }) as Record<string, unknown>;
    expect(r.email).toBe("[REDACTED:pii]");
    expect(r.phone).toBe("[REDACTED:pii]");
    expect(r.phone_numbers).toBe("[REDACTED:pii]");
    expect(r.display_name).toBe("[REDACTED:pii]");
    expect(r.first_name).toBe("[REDACTED:pii]");
    expect(r.last_name).toBe("[REDACTED:pii]");
    expect(r.keep).toBe("ok");
  });

  it("recurses into nested objects and arrays", () => {
    const r = redactDeep({
      users: [{ email: "a@b.com", display_name: "A B" }],
      meta: { secret: "s", note: "fine" },
    }) as { users: { email: string; display_name: string }[]; meta: { secret: string; note: string } };
    expect(r.users[0].email).toBe("[REDACTED:pii]");
    expect(r.users[0].display_name).toBe("[REDACTED:pii]");
    expect(r.meta.secret).toBe("[REDACTED]");
    expect(r.meta.note).toBe("fine");
  });
});
