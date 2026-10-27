/**
 * The client for the real MolTol backend (backend/apps/api) — the only data
 * source the app runs on. `get()`/`call()` resolve to `null`/throw on a
 * network failure or no backend configured; there is no local/seeded
 * fallback behind any of this (see BE_MISSING_THINGS.md for current gaps).
 */

const BASE = import.meta.env.PUBLIC_BACKEND_BASE as string | undefined;

async function get<T>(path: string): Promise<T | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(4000),
    });
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
  const h = await get<{ status: string }>("/healthz");
  if (!h || h.status !== "ok") return { ok: false };
  const v = await get<{ version: string }>("/v1/version");
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
export async function backendComps(
  query: string,
  currency = "INR",
): Promise<BackendMarketRange | null> {
  if (!query.trim()) return null;
  return get<BackendMarketRange>(
    `/v1/market/comps?query=${encodeURIComponent(query)}&currency=${currency}`,
  );
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

  constructor(
    status: number,
    title: string,
    detail?: string,
    secondsRemaining?: number,
  ) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.secondsRemaining = secondsRemaining;
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!BASE)
    throw new BackendAuthError(
      0,
      "backend_not_configured",
      "No backend is configured for this build.",
    );
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BackendAuthError(
      0,
      "network_error",
      "Couldn't reach the backend. Check your connection.",
    );
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BackendAuthError(
      res.status,
      json.title ?? "error",
      json.detail,
      json.secondsRemaining,
    );
  }
  return json as T;
}

async function authedCall<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  if (!BASE)
    throw new BackendAuthError(
      0,
      "backend_not_configured",
      "No backend is configured for this build.",
    );
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BackendAuthError(
      0,
      "network_error",
      "Couldn't reach the backend. Check your connection.",
    );
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BackendAuthError(
      res.status,
      json.title ?? "error",
      json.detail,
      json.secondsRemaining,
    );
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
  return call("POST", "/v1/auth/signup", { email, password });
}
export function verifySignupOtp(
  email: string,
  code: string,
): Promise<AuthSession> {
  return call("POST", "/v1/auth/otp/verify", { email, code });
}
export function resendSignupOtp(
  email: string,
): Promise<{ ok: boolean; resendCooldownSeconds: number }> {
  return call("POST", "/v1/auth/otp/resend", { email });
}
export function login(email: string, password: string): Promise<AuthSession> {
  return call("POST", "/v1/auth/login", { email, password });
}
export function forgotPassword(
  email: string,
): Promise<{ ok: boolean; message: string }> {
  return call("POST", "/v1/auth/password/forgot", { email });
}
export function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<AuthSession> {
  return call("POST", "/v1/auth/password/reset", { email, code, newPassword });
}
export function me(token: string): Promise<AuthUser> {
  return authedCall("GET", "/v1/me", token);
}

export interface Shop {
  id: string;
  name: string;
  emoji: string;
  persona?: string;
  currency?: string;
  location?: { lat: number; lng: number } | null;
  status?: ShopStatus;
  /** Epoch ms the pin last moved; now on every shop view, not just the nearby list. */
  locationUpdatedAt?: number | null;
}
export interface ShopItem {
  id: string;
  shopId: string;
  name: string;
  emoji: string | null;
  sellCents: number;
  floorCents: number;
  /** Seller-only; never present on a public/buyer-facing item. */
  costCents?: number | null;
  category?: string | null;
  quantity: number | null;
  /** Low-stock alert threshold, in `unit`; 0/unset disables the hint. */
  lowStockAt?: number | null;
  /** Soft delete — write via `updateShopItem(token, id, { archived })`. */
  archived?: boolean | null;
  unit: string | null;
  customUnit?: string | null;
  /** Grams/millilitres per unit, for `pack`/`custom` units. */
  packSize?: number | null;
  hindiName: string | null;
}
export type PublicShopItem = Omit<ShopItem, "floorCents" | "costCents">;

export interface ShopItemInput {
  name: string;
  emoji?: string;
  sellCents: number;
  floorCents: number;
  costCents?: number;
  category?: string;
  quantity?: number;
  lowStockAt?: number;
  unit?: string;
  customUnit?: string;
  packSize?: number;
  hindiName?: string;
  /** Patch-only in practice — soft delete / restore. */
  archived?: boolean;
}

export function createShop(
  token: string,
  name: string,
  emoji: string,
): Promise<Shop> {
  return authedCall("POST", "/v1/shops/me", token, { name, emoji });
}
export function getMyShop(
  token: string,
): Promise<Shop & { items: ShopItem[] }> {
  return authedCall("GET", "/v1/shops/me", token);
}
export function addShopItem(
  token: string,
  item: ShopItemInput,
): Promise<ShopItem> {
  return authedCall("POST", "/v1/shops/me/items", token, item);
}
export function updateShopItem(
  token: string,
  itemId: string,
  patch: Partial<ShopItemInput>,
): Promise<ShopItem> {
  return authedCall("PATCH", `/v1/shops/me/items/${itemId}`, token, patch);
}
export function deleteShopItem(token: string, itemId: string): Promise<void> {
  return authedCall("DELETE", `/v1/shops/me/items/${itemId}`, token);
}
/** +/- stock with an audit trail; `opId` makes a retried call a no-op instead of double-adjusting. */
export function adjustShopItemStock(
  token: string,
  itemId: string,
  delta: number,
  reason?: string,
  opId?: string,
): Promise<ShopItem> {
  return authedCall("POST", `/v1/shops/me/items/${itemId}/adjust`, token, {
    delta,
    reason,
    opId,
  });
}
export function getPublicShop(
  shopId: string,
): Promise<Shop & { items: PublicShopItem[] }> {
  return call("GET", `/v1/shops/${shopId}`);
}

/* ---------------------------------------------------------------------------
 * Baskets — the real haggle. See `backend/apps/api/src/basket-routes.ts` and
 * `backend/packages/contracts/src/basket.ts`, which these types mirror.
 * ------------------------------------------------------------------------- */

export type HaggleTone = "polite" | "playful" | "firm";
export type HagglePreset = "quick" | "balanced" | "hard";
export type NegotiationLineState =
  | "init"
  | "committed"
  | "negotiating"
  | "agreed"
  | "payment_pending"
  | "paid"
  | "revealed"
  | "no_deal"
  | "failed";
export type BasketState =
  "negotiating" | "settled" | "payment_pending" | "paid" | "failed";
export type BasketPaymentStatus =
  "order_created" | "approved" | "captured" | "failed" | "refunded";

export interface BasketLine {
  lineItemId: string;
  itemId: string;
  name: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  listCents: number;
  listLineCents: number;
  state: NegotiationLineState;
  controlled: boolean;
  askCents: number;
  lastBuyerCents: number | null;
  agreedUnitCents: number | null;
  agreedLineCents: number | null;
  market: BackendMarketRange | null;
}
export interface Basket {
  id: string;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  currency: string;
  state: BasketState;
  request: { rounds: number; tone: HaggleTone; preset: HagglePreset | null };
  lines: BasketLine[];
  totals: {
    listCents: number;
    agreedCents: number;
    savedCents: number;
    agreedLines: number;
    openLines: number;
  };
  paypalOrderId: string | null;
  createdAt: string;
}
export interface LineActionResult {
  line: BasketLine;
  accepted: boolean;
  counterCents: number | null;
}
export interface AcceptAllResult {
  agreed: Array<{ lineItemId: string; unitCents: number; lineCents: number }>;
  basket: Basket;
}
export interface BasketCheckoutResult {
  basketId: string;
  paypalOrderId: string;
  approveUrl: string | null;
  amountCents: number;
  currency: string;
  deal: { amountCents: number; currency: string };
  fxRate: number;
}
export interface ProofResult {
  negotiationId: string;
  verified: boolean;
  fairness: number;
  buyerSavedCents: number;
  shopGainedCents: number;
  priceCents: number;
  currency: string;
  buyerCommit: string;
  shopCommit: string;
  reasons: string[];
  reveal: {
    buyerLimitCents: number;
    buyerSalt: string;
    shopFloorCents: number;
    shopSalt: string;
  };
}
export interface BasketCaptureResult {
  basketId: string;
  status: BasketPaymentStatus;
  captureId: string | null;
  proofs: ProofResult[];
}

export function createBasket(
  token: string,
  input: {
    shopId: string;
    lines: Array<{ itemId: string; qty: number }>;
    request?: { preset?: HagglePreset; rounds?: number; tone?: HaggleTone };
  },
): Promise<Basket> {
  return authedCall("POST", "/v1/baskets", token, input);
}
export function getBasket(token: string, basketId: string): Promise<Basket> {
  return authedCall("GET", `/v1/baskets/${basketId}`, token);
}
export function takeoverLine(
  token: string,
  basketId: string,
  lineId: string,
): Promise<LineActionResult> {
  return authedCall(
    "POST",
    `/v1/baskets/${basketId}/lines/${lineId}/takeover`,
    token,
  );
}
export function offerLine(
  token: string,
  basketId: string,
  lineId: string,
  priceCents: number,
): Promise<LineActionResult> {
  return authedCall(
    "POST",
    `/v1/baskets/${basketId}/lines/${lineId}/offer`,
    token,
    { priceCents },
  );
}
export function acceptLine(
  token: string,
  basketId: string,
  lineId: string,
): Promise<LineActionResult> {
  return authedCall(
    "POST",
    `/v1/baskets/${basketId}/lines/${lineId}/accept`,
    token,
  );
}
export function acceptAllLines(
  token: string,
  basketId: string,
): Promise<AcceptAllResult> {
  return authedCall("POST", `/v1/baskets/${basketId}/accept-all`, token);
}
export function checkoutBasket(
  token: string,
  basketId: string,
): Promise<BasketCheckoutResult> {
  return authedCall("POST", `/v1/baskets/${basketId}/checkout`, token);
}
export function captureBasket(
  token: string,
  basketId: string,
): Promise<BasketCaptureResult> {
  return authedCall("POST", `/v1/baskets/${basketId}/capture`, token);
}

/* ---------------------------------------------------------------------------
 * Orders — a checked-out basket, in the frontend's own `Order` vocabulary.
 * ------------------------------------------------------------------------- */

export interface BackendOrderLine {
  lineItemId: string;
  itemId: string | null;
  title: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  unitCents: number | null;
  lineCents: number | null;
  listLineCents: number;
  noDeal: boolean;
}
export interface BackendOrder {
  id: string;
  ts: string;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  currency: string;
  lines: BackendOrderLine[];
  totalCents: number;
  listCents: number;
  marketCents: number;
  savingsCents: number;
  fairness: number | null;
  proofVerified: boolean;
  paymentStatus: BasketPaymentStatus;
}

export function listOrders(token: string): Promise<BackendOrder[]> {
  return authedCall("GET", "/v1/orders", token);
}
export function getOrder(token: string, id: string): Promise<BackendOrder> {
  return authedCall("GET", `/v1/orders/${id}`, token);
}

/* ---------------------------------------------------------------------------
 * Discovery and stall status.
 * ------------------------------------------------------------------------- */

export interface ShopStatus {
  open: boolean;
  closeAt: number | null;
  reopenAt: number | null;
}
export interface NearbyShop {
  id: string;
  name: string;
  emoji: string;
  persona: string;
  currency: string;
  location: { lat: number; lng: number } | null;
  status: ShopStatus;
  distanceM: number;
  itemCount: number;
  /** Epoch ms the pin last moved — null if never shared live. */
  locationUpdatedAt: number | null;
}

export function nearbyShops(
  lat: number,
  lng: number,
  radiusM = 3000,
): Promise<NearbyShop[]> {
  return call(
    "GET",
    `/v1/shops/nearby?lat=${lat}&lng=${lng}&radiusM=${radiusM}`,
  );
}
export function updateShopLocation(
  token: string,
  location: { lat: number; lng: number } | null,
): Promise<Shop> {
  return authedCall("PATCH", "/v1/shops/me", token, { location });
}
/**
 * The dedicated continuous-push endpoint — distinct from the one-shot
 * `updateShopLocation` above. Meant to be called every few seconds while a
 * stall with a moving cart is open; `GET /v1/shops/nearby`'s
 * `locationUpdatedAt` reflects how fresh the last push was.
 */
export function updateShopLiveLocation(
  token: string,
  location: { lat: number; lng: number },
): Promise<Shop> {
  return authedCall("PATCH", "/v1/shops/me/location", token, location);
}
export function setShopStatus(
  token: string,
  input: { open: boolean; closeInMin?: number; reopenInMin?: number },
): Promise<{ status: ShopStatus }> {
  return authedCall("PUT", "/v1/shops/me/status", token, input);
}

export interface ShopDeal {
  id: string;
  ts: string;
  itemId: string | null;
  name: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  won: boolean;
  unitCents: number | null;
  lineCents: number | null;
  listCents: number;
  currency: string;
}
export function getShopDeals(
  token: string,
  since?: string,
): Promise<ShopDeal[]> {
  return authedCall(
    "GET",
    `/v1/shops/me/deals${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    token,
  );
}

/* ---------------------------------------------------------------------------
 * Session / preferences.
 * ------------------------------------------------------------------------- */

export type Role = "buyer" | "seller";

export interface Me {
  id: string;
  email: string;
  hasShop: boolean;
  activeRole: Role;
  hagglePreset: HagglePreset;
  shop?: { id: string; name: string; emoji: string };
}

export function getMe(token: string): Promise<Me> {
  return authedCall("GET", "/v1/me", token);
}
export function setRole(
  token: string,
  activeRole: Role,
): Promise<{ activeRole: Role }> {
  return authedCall("PATCH", "/v1/me/role", token, { activeRole });
}
export function setHagglePreset(
  token: string,
  preset: HagglePreset,
): Promise<{ preset: HagglePreset }> {
  return authedCall("PUT", "/v1/me/preferences/haggle", token, { preset });
}
export function logout(token: string): Promise<void> {
  return authedCall("POST", "/v1/auth/logout", token);
}

/* ------------------------------- ledger (seller) -------------------------- */

export type LedgerPeriod = "7d" | "30d" | "90d" | "all";

export interface LedgerWindow {
  period: LedgerPeriod;
  from: string | null;
  to: string;
}
export interface LedgerRow {
  id: string;
  ts: string;
  basketId: string;
  itemId: string | null;
  name: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  won: boolean;
  unitCents: number | null;
  lineCents: number | null;
  listCents: number;
  listLineCents: number;
  floorCents: number | null;
  floorLineCents: number | null;
  marginCents: number | null;
  discountPct: number;
  fairness: number | null;
  proofVerified: boolean;
  currency: string;
}
export interface LedgerKpis {
  deals: { total: number; won: number; lost: number; winRatePct: number };
  unitsSold: number;
  revenueCents: number;
  listCents: number;
  savingsGivenCents: number;
  marginKeptCents: number;
  avgDiscountPct: number;
  avgFairness: number | null;
  proofVerifiedRatePct: number;
}
export interface LedgerBar {
  label: string;
  valueCents: number;
  count: number;
}
export interface LedgerBucket {
  label: string;
  from: number;
  to: number;
  count: number;
}
export interface LedgerFunnelStage {
  stage: "created" | "settled" | "checked_out" | "paid";
  label: string;
  count: number;
}
export interface LedgerWidgets {
  marginByItem: LedgerBar[];
  revenueByItem: LedgerBar[];
  fairnessHistogram: LedgerBucket[];
  dealFunnel: LedgerFunnelStage[];
}
export interface Ledger {
  window: LedgerWindow;
  currency: string;
  kpis: LedgerKpis;
  widgets: LedgerWidgets;
  rows: LedgerRow[];
}
export interface LedgerSummary {
  window: LedgerWindow;
  currency: string;
  kpis: LedgerKpis;
}
export interface LedgerAnswer {
  answer: string;
  source: "hybrid" | "heuristic" | "paypal";
  facts: string[];
  window: LedgerWindow;
}

export function getLedger(token: string, period: LedgerPeriod = "30d"): Promise<Ledger> {
  return authedCall("GET", `/v1/ledger?period=${period}`, token);
}
export function getLedgerSummary(
  token: string,
  period: LedgerPeriod = "30d",
): Promise<LedgerSummary> {
  return authedCall("GET", `/v1/ledger/summary?period=${period}`, token);
}
export function askLedger(
  token: string,
  question: string,
  period: LedgerPeriod = "30d",
): Promise<LedgerAnswer> {
  return authedCall("POST", "/v1/ledger/ask", token, { question, period });
}

/* ------------------------------ insights (buyer) --------------------------- */

export interface BuyerInsightCard {
  kind: "savings" | "streak" | "budget" | "fairness" | "shops" | "spend";
  title: string;
  value: number;
  detail: string;
}
export interface BuyerInsights {
  orders: number;
  totalSpentCents: number;
  totalListCents: number;
  totalSavedCents: number;
  avgSavingsPct: number;
  avgFairness: number | null;
  streakDays: number;
  budgetCents: number | null;
  cards: BuyerInsightCard[];
}

export function getBuyerInsights(
  token: string,
  budgetCents?: number,
): Promise<BuyerInsights> {
  const qs = budgetCents != null ? `?budgetCents=${budgetCents}` : "";
  return authedCall("GET", `/v1/insights/buyer${qs}`, token);
}

/* --------------------------- snap-to-add (vendor) --------------------------- */

export interface SnapSuggestion {
  name: string;
  emoji: string;
  unit: string | null;
  sellCents: number | null;
  floorCents: number | null;
  confidence: number;
}
export interface SnapResponse {
  source: "vision" | "catalogue";
  suggestions: SnapSuggestion[];
}

/** `imageDataUrl` is a `data:image/...;base64,...` string straight off a <canvas>/<input>. */
export function snapInventory(
  token: string,
  imageDataUrl: string,
  hint?: string,
): Promise<SnapResponse> {
  return authedCall("POST", "/v1/inventory/snap", token, { image: imageDataUrl, hint });
}

/* ------------------------- seller live deal feed ---------------------------- */

export interface DealStreamTicket {
  ticket: string;
  expiresInSec: number;
}

/** A 2-minute, shop-scoped ticket — `EventSource` can't send an auth header, so this goes in the query string. */
export function getDealsTicket(token: string): Promise<DealStreamTicket> {
  return authedCall("POST", "/v1/shops/me/deals/ticket", token);
}

/** Build the seller's private live-deal SSE URL once a fresh ticket is in hand. */
export function dealsStreamUrl(ticket: string): string | null {
  if (!BASE) return null;
  return `${BASE}/v1/shops/me/deals/stream?ticket=${encodeURIComponent(ticket)}`;
}

export type DealFeedEvent =
  | {
      t: "deal.incoming";
      shopId: string;
      basketId: string;
      ts: string;
      currency: string;
      totalCents: number;
      lines: Array<{ name: string; qty: number; unit: string | null; listCents: number }>;
    }
  | {
      t: "deal.closed";
      shopId: string;
      basketId: string;
      ts: string;
      lineItemId: string;
      name: string;
      won: boolean;
      unitCents: number | null;
      currency: string;
    };

/* ------------------------------ payment retry -------------------------------- */

/** Retry a denied/expired PayPal order for the same agreed lines — no new haggle needed. */
export function retryBasketCheckout(
  token: string,
  basketId: string,
): Promise<BasketCheckoutResult> {
  return authedCall("POST", `/v1/baskets/${basketId}/retry`, token);
}
