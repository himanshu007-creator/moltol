/**
 * Thin client for the real MolTol backend (backend/apps/api), when one is
 * running. Every call is fire-and-forget safe: network errors, CORS failures,
 * or no backend at all all resolve to `null`, never throw. Nothing here
 * replaces the mock seam in `lib/mock/*` — this is additive, opt-in wiring
 * for the pieces that are honestly compatible today (see BE_MISSING_THINGS.md
 * for why the negotiation/bazaar model itself isn't wired yet).
 */

const BASE = import.meta.env.PUBLIC_BACKEND_BASE as string | undefined;

async function get<T>(path: string): Promise<T | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface BackendHealth {
  ok: boolean;
  version?: string;
}

/** True when a real backend answers /healthz. Used to show/hide the "live backend" badge. */
export async function backendHealth(): Promise<BackendHealth> {
  const h = await get<{ status: string }>('/healthz');
  if (!h || h.status !== 'ok') return { ok: false };
  const v = await get<{ version: string }>('/v1/version');
  return { ok: true, version: v?.version };
}

export interface BackendMarketRange {
  medianCents: number;
  p25Cents: number;
  p75Cents: number;
  sampleCount: number;
  source: string;
}

/** Live market comps from the real backend (Channel3-backed, or its seeded fallback). */
export async function backendComps(query: string, currency = 'INR'): Promise<BackendMarketRange | null> {
  if (!query.trim()) return null;
  return get<BackendMarketRange>(`/v1/market/comps?query=${encodeURIComponent(query)}&currency=${currency}`);
}

/* ---------------------------------------------------------------------------
 * Auth + vendor calls. Unlike `get()` above, these are NOT optional — there's
 * no mock fallback for real auth — so they throw a typed error instead of
 * silently resolving to null. The shape mirrors the backend's RFC 9457
 * `application/problem+json` body.
 * ------------------------------------------------------------------------- */

export class BackendAuthError extends Error {
  status: number;
  title: string;
  detail?: string;
  secondsRemaining?: number;

  constructor(status: number, title: string, detail?: string, secondsRemaining?: number) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.secondsRemaining = secondsRemaining;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!BASE) throw new BackendAuthError(0, 'backend_not_configured', 'No backend is configured for this build.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BackendAuthError(0, 'network_error', "Couldn't reach the backend. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BackendAuthError(res.status, json.title ?? 'error', json.detail, json.secondsRemaining);
  }
  return json as T;
}

async function authedCall<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  if (!BASE) throw new BackendAuthError(0, 'backend_not_configured', 'No backend is configured for this build.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BackendAuthError(0, 'network_error', "Couldn't reach the backend. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BackendAuthError(res.status, json.title ?? 'error', json.detail, json.secondsRemaining);
  }
  return json as T;
}

export interface AuthUser {
  id: string;
  email: string;
  hasShop: boolean;
  shop?: { id: string; name: string; emoji: string };
}
export interface AuthSession {
  token: string;
  user: AuthUser;
}
export interface SignupResult {
  normalizedEmail: string;
  message: string;
  resendCooldownSeconds: number;
}

export function signup(email: string, password: string): Promise<SignupResult> {
  return call('POST', '/v1/auth/signup', { email, password });
}
export function verifySignupOtp(email: string, code: string): Promise<AuthSession> {
  return call('POST', '/v1/auth/otp/verify', { email, code });
}
export function resendSignupOtp(email: string): Promise<{ ok: boolean; resendCooldownSeconds: number }> {
  return call('POST', '/v1/auth/otp/resend', { email });
}
export function login(email: string, password: string): Promise<AuthSession> {
  return call('POST', '/v1/auth/login', { email, password });
}
export function forgotPassword(email: string): Promise<{ ok: boolean; message: string }> {
  return call('POST', '/v1/auth/password/forgot', { email });
}
export function resetPassword(email: string, code: string, newPassword: string): Promise<AuthSession> {
  return call('POST', '/v1/auth/password/reset', { email, code, newPassword });
}
export function me(token: string): Promise<AuthUser> {
  return authedCall('GET', '/v1/me', token);
}

export interface Shop {
  id: string;
  name: string;
  emoji: string;
}
export interface ShopItem {
  id: string;
  shopId: string;
  name: string;
  emoji: string | null;
  sellCents: number;
  floorCents: number;
  quantity: number | null;
  unit: string | null;
  hindiName: string | null;
}
export type PublicShopItem = Omit<ShopItem, 'floorCents'>;

export function createShop(token: string, name: string, emoji: string): Promise<Shop> {
  return authedCall('POST', '/v1/shops/me', token, { name, emoji });
}
export function getMyShop(token: string): Promise<Shop & { items: ShopItem[] }> {
  return authedCall('GET', '/v1/shops/me', token);
}
export function addShopItem(
  token: string,
  item: { name: string; emoji?: string; sellCents: number; floorCents: number; quantity?: number; unit?: string; hindiName?: string },
): Promise<ShopItem> {
  return authedCall('POST', '/v1/shops/me/items', token, item);
}
export function updateShopItem(token: string, itemId: string, patch: Partial<ShopItem>): Promise<ShopItem> {
  return authedCall('PATCH', `/v1/shops/me/items/${itemId}`, token, patch);
}
export function deleteShopItem(token: string, itemId: string): Promise<void> {
  return authedCall('DELETE', `/v1/shops/me/items/${itemId}`, token);
}
export function getPublicShop(shopId: string): Promise<Shop & { items: PublicShopItem[] }> {
  return call('GET', `/v1/shops/${shopId}`);
}
