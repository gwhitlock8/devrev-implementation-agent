/** Keys whose values are always replaced with [REDACTED] regardless of shape. */
const TOKEN_KEYS = new Set([
  "authorization",
  "pat",
  "token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "bearer",
  "credential",
  "credentials",
  "private_key",
  "access_key",
  "access_token",
  "refresh_token",
]);

/**
 * Keys whose values are PII the user might not want in the audit log. Replaced
 * with a stable [REDACTED:pii] sentinel so log shape is preserved for ops use,
 * but values aren't recoverable.
 */
const PII_KEYS = new Set([
  "email",
  "emails",
  "phone",
  "phone_numbers",
  "phone_number",
  "display_name",
  "full_name",
  "first_name",
  "last_name",
]);

/** Substring matches on key names — catches custom keys like "user_token", "session_secret". */
function matchesKeyPattern(lk: string): boolean {
  return (
    lk.includes("token") ||
    lk.includes("secret") ||
    lk.includes("password") ||
    lk.includes("api_key") ||
    lk.includes("apikey")
  );
}

export function redactDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 12 && /^[A-Za-z0-9._-]+$/.test(value) && value.length > 40) {
      return "[REDACTED:string]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (TOKEN_KEYS.has(lk) || matchesKeyPattern(lk)) {
        out[k] = "[REDACTED]";
      } else if (PII_KEYS.has(lk)) {
        out[k] = "[REDACTED:pii]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}
