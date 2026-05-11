import { DevRevHttpClient, type DevRevClientOptions } from "./client.js";

/**
 * A read-only wrapper around DevRevHttpClient that blocks any mutating
 * operations. Used by `dia research` to ensure the internal org PAT
 * can never accidentally create, update, or delete objects.
 *
 * Allowed operations: *.list, *.get, *.search, dev-users.self, search.*
 * Blocked: *.create, *.update, *.delete, and anything else.
 */

const ALLOWED_PATTERNS = [
  /\.list$/,
  /\.get$/,
  /\.search$/,
  /^search\./,
  /^dev-users\.self$/,
  /\.export$/,
];

export class ReadOnlyDevRevClient {
  private readonly client: DevRevHttpClient;

  constructor(opts: DevRevClientOptions) {
    this.client = new DevRevHttpClient(opts);
  }

  private assertReadOnly(operation: string): void {
    const allowed = ALLOWED_PATTERNS.some((re) => re.test(operation));
    if (!allowed) {
      throw new Error(
        `ReadOnlyDevRevClient: blocked mutating operation "${operation}". ` +
        `Only list/get/search operations are allowed on the research PAT.`,
      );
    }
  }

  async post<T = unknown>(operation: string, body: unknown): Promise<T> {
    this.assertReadOnly(operation);
    return this.client.post<T>(operation, body);
  }

  async get<T = unknown>(
    operation: string,
    query?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    this.assertReadOnly(operation);
    return this.client.get<T>(operation, query);
  }
}
