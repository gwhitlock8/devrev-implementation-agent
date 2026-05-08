import type { RunManifest } from "./manifest.js";

export type ResolveContext = {
  manifest: RunManifest;
  selfDisplayId: string;
};

export function resolveOwnedBy(raw: unknown, ctx: ResolveContext): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((x) => {
    if (x === "SELF") return ctx.selfDisplayId;
    if (typeof x === "string") return x;
    return String(x);
  });
}

export function resolveRefToken(token: unknown, ctx: ResolveContext): string | undefined {
  if (typeof token === "string") {
    if (token === "SELF") return ctx.selfDisplayId;
    if (token.startsWith("__REF:")) {
      const key = token.slice("__REF:".length);
      return ctx.manifest.refs[key]?.display_id ?? ctx.manifest.refs[key]?.id;
    }
    return token;
  }
  if (token && typeof token === "object" && "__ref" in (token as object)) {
    const ref = (token as { __ref: string }).__ref;
    return ctx.manifest.refs[ref]?.display_id ?? ctx.manifest.refs[ref]?.id;
  }
  return undefined;
}

/** Resolve DevRev request bodies produced by the blueprint builder */
export function resolveDeep(value: unknown, ctx: ResolveContext): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value === "__MISSING_PARENT_REF__") return value;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx));
  if (typeof value === "object") {
    if ("__ref" in (value as object)) {
      const id = resolveRefToken(value, ctx);
      return id ?? value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveDeep(v, ctx);
    }
    return out;
  }
  return value;
}
