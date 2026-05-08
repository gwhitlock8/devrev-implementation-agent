import { redactDeep } from "../util/redact.js";

export type DevRevRequestMeta = {
  operation: string;
  method: "GET" | "POST";
  redactedBody?: unknown;
  redactedQuery?: Record<string, string | string[]>;
};

export type DevRevClientHooks = {
  beforeRequest?: (m: DevRevRequestMeta) => void;
  afterResponse?: (m: DevRevRequestMeta & { status: number; ok: boolean }) => void;
};

export type DevRevClientOptions = {
  pat: string;
  baseUrl?: string;
  /** Send X-Devrev-Scope: beta for beta-only operations (e.g. some incident flows). */
  betaScope?: boolean;
  /** X-Devrev-Version header (default: omit for platform default). */
  apiVersion?: string;
  hooks?: DevRevClientHooks;
  fetchFn?: typeof fetch;
};

export class DevRevHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(message);
    this.name = "DevRevHttpError";
  }
}

export class DevRevHttpClient {
  private readonly pat: string;
  private readonly baseUrl: string;
  private readonly betaScope: boolean;
  private readonly apiVersion?: string;
  private readonly hooks: DevRevClientHooks;
  private readonly fetchFn: typeof fetch;

  constructor(opts: DevRevClientOptions) {
    this.pat = opts.pat;
    this.baseUrl = (opts.baseUrl ?? "https://api.devrev.ai").replace(/\/$/, "");
    this.betaScope = opts.betaScope ?? false;
    this.apiVersion = opts.apiVersion;
    this.hooks = opts.hooks ?? {};
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async post<T = unknown>(operation: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}/${operation}`;
    const redactedBody = redactDeep(body);
    this.hooks.beforeRequest?.({
      operation,
      method: "POST",
      redactedBody,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.pat}`,
      "Content-Type": "application/json",
    };
    if (this.betaScope) headers["X-Devrev-Scope"] = "beta";
    if (this.apiVersion) headers["X-Devrev-Version"] = this.apiVersion;

    const maxAttempts = 4;
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        const res = await this.fetchFn(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body ?? {}),
        });
        if (res.status === 429) {
          lastErr = new DevRevHttpError(
            `DevRev API ${operation} rate-limited: HTTP 429`,
            429,
            await res.text(),
          );
          const retryAfter = Number(res.headers.get("retry-after") ?? "2") || 2;
          await sleep(Math.min(30_000, retryAfter * 1000 * attempt));
          continue;
        }
        const text = await res.text();
        this.hooks.afterResponse?.({
          operation,
          method: "POST",
          redactedBody,
          status: res.status,
          ok: res.ok,
        });
        if (!res.ok) {
          throw new DevRevHttpError(
            `DevRev API ${operation} failed: HTTP ${res.status}`,
            res.status,
            text,
          );
        }
        return text ? (JSON.parse(text) as T) : ({} as T);
      } catch (e) {
        lastErr = e;
        if (e instanceof DevRevHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }
        if (attempt >= maxAttempts) break;
        await sleep(500 * attempt);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr ?? "Unknown DevRev request error"));
  }

  async get<T = unknown>(
    operation: string,
    query?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) qs.append(k, String(item));
        } else {
          qs.set(k, String(v));
        }
      }
    }
    const q = qs.toString();
    const url = q ? `${this.baseUrl}/${operation}?${q}` : `${this.baseUrl}/${operation}`;
    const redactedQuery: Record<string, string | string[]> = {};
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        redactedQuery[k] = Array.isArray(v) ? v.map(String) : String(v);
      }
    }
    this.hooks.beforeRequest?.({
      operation,
      method: "GET",
      redactedQuery,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.pat}`,
    };
    if (this.betaScope) headers["X-Devrev-Scope"] = "beta";
    if (this.apiVersion) headers["X-Devrev-Version"] = this.apiVersion;

    let attempt = 0;
    const maxAttempts = 4;
    let lastErr: unknown;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        const res = await this.fetchFn(url, { method: "GET", headers });
        if (res.status === 429) {
          lastErr = new DevRevHttpError(
            `DevRev API ${operation} rate-limited: HTTP 429`,
            429,
            await res.text(),
          );
          const retryAfter = Number(res.headers.get("retry-after") ?? "2") || 2;
          await sleep(Math.min(30_000, retryAfter * 1000 * attempt));
          continue;
        }
        const text = await res.text();
        this.hooks.afterResponse?.({
          operation,
          method: "GET",
          redactedQuery,
          status: res.status,
          ok: res.ok,
        });
        if (!res.ok) {
          throw new DevRevHttpError(
            `DevRev API ${operation} failed: HTTP ${res.status}`,
            res.status,
            text,
          );
        }
        return text ? (JSON.parse(text) as T) : ({} as T);
      } catch (e) {
        lastErr = e;
        if (e instanceof DevRevHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }
        if (attempt >= maxAttempts) break;
        await sleep(500 * attempt);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr ?? "Unknown DevRev request error"));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
