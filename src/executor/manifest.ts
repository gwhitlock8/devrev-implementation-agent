import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ManifestEntry = {
  id: string;
  display_id?: string;
};

/**
 * Persistent state across apply runs. `refs` maps blueprint refs to created
 * DevRev objects (used for resolving __REF tokens in later steps). `completed`
 * is a step-id set used by `--resume` so re-running an apply skips work that
 * already succeeded.
 */
export type RunManifest = {
  refs: Record<string, ManifestEntry>;
  completed: Record<string, true>;
};

const FILENAME = "run-manifest.json";

/** Detect a legacy manifest (pre-Phase-B) which was just `Record<ref, entry>`. */
function isLegacy(raw: unknown): raw is Record<string, ManifestEntry> {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if ("refs" in obj && "completed" in obj) return false;
  // Heuristic: every value is a ManifestEntry-shaped object with an `id`.
  return Object.values(obj).every(
    (v) => v && typeof v === "object" && typeof (v as ManifestEntry).id === "string",
  );
}

export function emptyManifest(): RunManifest {
  return { refs: {}, completed: {} };
}

export async function loadManifest(outputDir: string): Promise<RunManifest> {
  try {
    const text = await readFile(join(outputDir, FILENAME), "utf8");
    const raw: unknown = JSON.parse(text);
    if (isLegacy(raw)) {
      return { refs: raw, completed: {} };
    }
    if (raw && typeof raw === "object" && "refs" in raw && "completed" in raw) {
      const m = raw as RunManifest;
      return { refs: m.refs ?? {}, completed: m.completed ?? {} };
    }
    return emptyManifest();
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(outputDir: string, m: RunManifest): Promise<void> {
  await writeFile(join(outputDir, FILENAME), JSON.stringify(m, null, 2), "utf8");
}
