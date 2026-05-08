import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

/**
 * Walk up from this file's location until we find a `.env`. Useful when the
 * CLI is invoked via a global symlink and `process.cwd()` is unrelated.
 */
function findProjectEnv(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Load env from the cwd `.env` first (so per-project overrides win), then fall
 * back to the agent's project `.env` (so a globally-symlinked `dia` still
 * picks up the dev's installed config).
 */
export function loadEnvFiles(): void {
  dotenvConfig();
  const projectEnv = findProjectEnv();
  if (projectEnv) dotenvConfig({ path: projectEnv });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v?.trim() || undefined;
}
