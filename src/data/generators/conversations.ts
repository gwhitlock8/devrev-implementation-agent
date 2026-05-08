import type { Scenario } from "../scenarios/types.js";
import { fakerFor, pickWeighted } from "./util.js";

export type GeneratedConversationEntry = {
  /** Blueprint work ref this comment attaches to. */
  object_ref: string;
  body: string;
  /** External-facing in nearly all POV demo cases. */
  visibility: "external" | "internal" | "private";
};

/**
 * Generate timeline-entry rows for a list of work refs. Each work gets
 * `perTicket` entries selected from the scenario's customer/agent dialogue
 * pool, alternating customer → agent → customer → … so threads read like a
 * real back-and-forth.
 */
export function generateConversations(
  scenario: Scenario,
  workRefs: string[],
  perTicket: number,
  seed?: number,
): GeneratedConversationEntry[] {
  const f = fakerFor(seed);
  const out: GeneratedConversationEntry[] = [];
  for (const ref of workRefs) {
    const pair = pickWeighted(f, scenario.conversations);
    for (let i = 0; i < perTicket; i++) {
      const isCustomer = i % 2 === 0;
      out.push({
        object_ref: ref,
        body: isCustomer ? pair.customer : pair.agent,
        visibility: "external",
      });
    }
  }
  return out;
}
