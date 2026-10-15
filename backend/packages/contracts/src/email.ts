/**
 * Email normalization for signup/login. Ported 1:1 from the reference Python.
 * `whitelistedDomains` are domains EXEMPT from normalization (kept exact,
 * only lowercased) — e.g. a corporate domain where the dot/+tag is part of
 * the real address. Every other domain gets dot/+tag stripped from the
 * local part and `googlemail.com` mapped to `gmail.com`, so
 * `himanshu+123@gmail.com` normalizes to `himanshu@gmail.com`. This product
 * has no exempt domains, so the default whitelist is empty and every
 * address gets normalized. Backend is the source of truth: the frontend
 * never re-derives this, it just displays whatever `normalized` this
 * returns.
 */

export const DEFAULT_WHITELISTED_EMAIL_DOMAINS = new Set<string>();

function splitEmail(email: string): [string, string] | [null, null] {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return [null, null];
  return [email.slice(0, at), email.slice(at + 1).toLowerCase()];
}

function cleanLocalPart(local: string): string {
  return local.split("+")[0]!.replace(/\./g, "");
}

function cleanDomain(domain: string): string {
  return domain === "googlemail.com" ? "gmail.com" : domain;
}

export function isWhitelistedDomain(
  email: string,
  whitelistedDomains: ReadonlySet<string> = DEFAULT_WHITELISTED_EMAIL_DOMAINS,
): boolean {
  const [, domain] = splitEmail(email);
  if (!domain) return false;
  return whitelistedDomains.has(domain) || whitelistedDomains.has(cleanDomain(domain));
}

export interface NormalizedEmail {
  normalized: string;
  local: string;
  domain: string;
}

/** Returns null for a malformed address (no/empty local part or domain). */
export function normalizeEmail(
  email: string,
  whitelistedDomains: ReadonlySet<string> = DEFAULT_WHITELISTED_EMAIL_DOMAINS,
): NormalizedEmail | null {
  const [local, domain] = splitEmail(email.trim());
  if (!local || !domain) return null;

  if (whitelistedDomains.has(domain)) {
    const lowerLocal = local.toLowerCase();
    return { normalized: `${lowerLocal}@${domain}`, local: lowerLocal, domain };
  }

  const cleanedDomain = cleanDomain(domain);
  if (whitelistedDomains.has(cleanedDomain)) {
    const lowerLocal = local.toLowerCase();
    return {
      normalized: `${lowerLocal}@${cleanedDomain}`,
      local: lowerLocal,
      domain: cleanedDomain,
    };
  }

  const cleanedLocal = cleanLocalPart(local).toLowerCase();
  return {
    normalized: `${cleanedLocal}@${cleanedDomain}`,
    local: cleanedLocal,
    domain: cleanedDomain,
  };
}
