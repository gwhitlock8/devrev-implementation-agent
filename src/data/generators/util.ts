import { Faker, en, faker as defaultFaker } from "@faker-js/faker";
import type { Scenario } from "../scenarios/types.js";

/**
 * Return a Faker we can safely call without polluting global state.
 * - Seeded: build a fresh `Faker({ locale: [en] })` and seed it. Determinism
 *   is local to the returned instance.
 * - Unseeded: return the package's global `faker`. This used to mutate the
 *   global with `seed()` calls — that turned subsequent unseeded calls into
 *   "continuation of last seeded sequence", which broke test isolation.
 */
export function fakerFor(seed: number | undefined): Faker {
  if (seed === undefined) return defaultFaker;
  const f = new Faker({ locale: [en] });
  f.seed(seed);
  return f;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pickWeighted<T>(f: Faker, weights: T[]): T {
  return weights[f.number.int({ min: 0, max: weights.length - 1 })];
}

export function fakeCompany(f: Faker, scenario: Scenario): { name: string; slug: string; domain: string } {
  const base = f.company.name();
  const suffix = pickWeighted(f, scenario.companySuffixes);
  const name = `${base} ${suffix}`;
  const slug = slugify(name);
  const domain = scenario.emailDomainTemplate.replace("${slug}", slug);
  return { name, slug, domain };
}
