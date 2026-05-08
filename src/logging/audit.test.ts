import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLogger, readAuditLog } from "./audit.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "audit-test-"));
}

describe("AuditLogger NDJSON", () => {
  it("appends one JSON object per line", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();
    await audit.log({ ts: "t1", phase: "execute", status: "ok", step_id: "s-1" });
    await audit.log({ ts: "t2", phase: "execute", status: "failed", step_id: "s-2", error: "boom" });
    const raw = await readFile(join(dir, "implementation-log.ndjson"), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).step_id).toBe("s-1");
    expect(JSON.parse(lines[1]).status).toBe("failed");
  });

  it("readAuditLog round-trips entries", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();
    await audit.log({ ts: "t1", phase: "execute", status: "ok", step_id: "s-1" });
    await audit.log({ ts: "t2", phase: "execute", status: "skipped", step_id: "s-2" });
    const entries = await readAuditLog(dir);
    expect(entries.length).toBe(2);
    expect(entries[0].step_id).toBe("s-1");
    expect(entries[1].status).toBe("skipped");
  });

  it("readAuditLog tolerates a corrupt line", async () => {
    const dir = await tempDir();
    const audit = new AuditLogger(dir);
    await audit.init();
    await audit.log({ ts: "t1", phase: "execute", status: "ok", step_id: "s-1" });
    // Append a malformed line directly.
    const path = join(dir, "implementation-log.ndjson");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, "not-json\n", "utf8");
    await audit.log({ ts: "t3", phase: "execute", status: "ok", step_id: "s-3" });
    const entries = await readAuditLog(dir);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.step_id)).toEqual(["s-1", "s-3"]);
  });
});
