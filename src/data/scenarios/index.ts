import type { ScenarioName } from "../../parsers/blueprint.js";
import { b2bSales } from "./b2b-sales.js";
import { devTooling } from "./dev-tooling.js";
import { saasSupport } from "./saas-support.js";
import type { Scenario } from "./types.js";

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  "saas-support": saasSupport,
  "b2b-sales": b2bSales,
  "dev-tooling": devTooling,
};

export function getScenario(name: ScenarioName): Scenario {
  return SCENARIOS[name];
}

export type { Scenario } from "./types.js";
