import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

/**
 * Well-known Claude models available via the Anthropic API.
 * Keep this list current — it's shown to the user as a picker.
 */
export const KNOWN_MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6  — default, fast & capable" },
  { id: "claude-opus-4-5",   label: "Opus 4.5   — most capable, slower" },
  { id: "claude-haiku-4-5",  label: "Haiku 4.5  — fastest, lowest cost" },
] as const;

export type KnownModelId = (typeof KNOWN_MODELS)[number]["id"];

/**
 * Interactively prompt the user to pick a model from KNOWN_MODELS.
 * Falls back to the default model if stdin is not a TTY.
 */
export async function pickModel(defaultModel: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return defaultModel;
  }

  const rl = createInterface({ input, output });
  try {
    process.stdout.write("\nSelect an Anthropic model:\n");
    KNOWN_MODELS.forEach((m, i) => {
      const marker = m.id === defaultModel ? " (default)" : "";
      process.stdout.write(`  [${i + 1}] ${m.id}  — ${m.label}${marker}\n`);
    });
    process.stdout.write(`  [${KNOWN_MODELS.length + 1}] Enter a custom model ID\n`);

    const answer = (
      await rl.question(`\nChoice [1-${KNOWN_MODELS.length + 1}]: `)
    ).trim();

    const num = parseInt(answer, 10);
    if (num >= 1 && num <= KNOWN_MODELS.length) {
      return KNOWN_MODELS[num - 1].id;
    }
    if (num === KNOWN_MODELS.length + 1) {
      const custom = (await rl.question("Custom model ID: ")).trim();
      if (custom) return custom;
    }

    // Any other input (including Enter with no value) → use default.
    process.stdout.write(`Using default: ${defaultModel}\n`);
    return defaultModel;
  } finally {
    rl.close();
  }
}
