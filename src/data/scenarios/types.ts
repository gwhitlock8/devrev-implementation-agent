import type { ScenarioName } from "../../parsers/blueprint.js";

export type Priority = "p0" | "p1" | "p2" | "p3";

export type ConversationPair = {
  /** Customer-side message, e.g. "I can't log in after resetting my password." */
  customer: string;
  /** Agent-side response. */
  agent: string;
};

export type Scenario = {
  name: ScenarioName;
  /** Human-readable industry/context, surfaced in `start` UX. */
  description: string;
  /** Suffixes joined to a base company name (e.g. "Inc", "Labs"). */
  companySuffixes: string[];
  /** Email domain pattern, `${slug}` substituted with kebab-case company name. */
  emailDomainTemplate: string;
  /** Title sources for ticket/issue generation. */
  ticketTitles: string[];
  issueTitles: string[];
  /** Distribution weight; array repeats values to bias the picker. */
  priorityWeights: Priority[];
  /** KB article titles (paired with faker-prose body in the generator). */
  articleTitles: string[];
  /** Customer-question / agent-response pairs for timeline-entry generation. */
  conversations: ConversationPair[];
};
