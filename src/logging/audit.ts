import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { redactDeep } from "../util/redact.js";

export type AuditEntry = {
  ts: string;
  step_id?: string;
  phase: "plan" | "execute";
  rationale?: string;
  operation?: string;
  method?: "GET" | "POST";
  request?: unknown;
  response_summary?: unknown;
  status: "ok" | "skipped" | "failed";
  error?: string;
};

const LOG_FILENAME = "implementation-log.ndjson";
const REPORT_FILENAME = "implementation-report.md";

export class AuditLogger {
  constructor(private readonly outputDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    const header = `# DevRev implementation report\n\nStarted: ${new Date().toISOString()}\n\n`;
    await writeFile(join(this.outputDir, REPORT_FILENAME), header, "utf8");
    // Truncate log so reruns don't append to a stale tail.
    await writeFile(join(this.outputDir, LOG_FILENAME), "", "utf8");
  }

  /**
   * Append a single audit entry. NDJSON: one JSON object per line. Append-only
   * I/O so cost is O(1) per entry, regardless of total entry count.
   */
  async log(entry: AuditEntry): Promise<void> {
    await appendFile(
      join(this.outputDir, LOG_FILENAME),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    const line =
      entry.status === "failed"
        ? `### ${entry.step_id ?? "?"} — FAILED\n${entry.error ?? ""}\n`
        : entry.status === "skipped"
          ? `### ${entry.step_id ?? "?"} — skipped\n${entry.rationale ?? ""}\n`
          : `### ${entry.step_id ?? "?"} — ok\n${entry.operation ?? ""}\n`;
    await appendFile(join(this.outputDir, REPORT_FILENAME), `${line}\n`, "utf8");
  }

  /** Safe structured snapshot for API payloads/responses */
  static snapshot(value: unknown): unknown {
    return redactDeep(value);
  }
}

/** Read an NDJSON audit log back as `AuditEntry[]`. Skips malformed lines. */
export async function readAuditLog(outputDir: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await readFile(join(outputDir, LOG_FILENAME), "utf8");
  } catch {
    return [];
  }
  const entries: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as AuditEntry);
    } catch {
      // Skip corrupt line — don't fail the whole load.
    }
  }
  return entries;
}
