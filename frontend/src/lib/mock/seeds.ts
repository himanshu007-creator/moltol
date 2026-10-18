/**
 * Mock seed data — one demo user holding BOTH roles, three demo shops, and a
 * comps library. Swap for a real API by replacing the adapters in lib/mock/*.
 * Money is integer paise (₹). listCents/floorCents are seller-side truth;
*  floorCents is NEVER rendered in a buyer view before the Proof reveal.
 */

export interface I18nName {
  en: string;
}

export interface InventoryItem {
  /** stable key, e.g. 'ki-tom' */
  sku: string;
  /** comps-library key this item prices against */
  itemId: ItemLib;
  title: I18nName;
  emoji: string;
  unit: string;
  listCents: number;
  /** seller-only red line — hidden from buyer UI entirely */
  floorCents: number;
  stock: number;
  /** explicit market band for items not in COMP_LIB (vendor-added items) */
  market?: { median: number; p25: number; p75: number };
  /**
   * The real backend `shop_items.id` (UUID), set only when this item came
   * from `GET /v1/shops/:shopId` instead of the seeded catalogue. Its
   * presence (alongside the parent `Shop.backendShopId`) is what tells
   * `bazaar.ts` to haggle this lane against the real basket API instead of
   * running the local simulation.
   */
  backendItemId?: string;
}

export type ShopKind = 'thela' | 'kirana' | 'fruit';

export interface Shop {
  id: string;
  name: I18nName;
  kind: ShopKind;
  emoji: string;
  /** normalized map coords (0..100) */
  x: number;
  y: number;
  /** real-world coords (Jalandhar bazaar); the map projects these around BAZAAR_CENTER */
  lat: number;
  lng: number;
  distanceM: number;
  persona: 'charmer' | 'stoic' | 'storyteller' | 'analyst';
  products: InventoryItem[];
  /** cross-item tactic mock: "buy both, save" */
  bundle?: { skus: [string, string]; discountCents: number };
  /** The real backend `shops.id` (UUID), set only for a shop fetched from `/v1/shops/nearby` or `/v1/shops/:id`. */
  backendShopId?: string;
}

const I = (
  sku: string,
  itemId: ItemLib,
  en: string,
  emoji: string,
  unit: string,
  listCents: number,
  floorCents: number,
  stock: number,
): InventoryItem => ({ sku, itemId, title: { en }, emoji, unit, listCents, floorCents, stock });

const thela: InventoryItem[] = [
  I('th-tom', 'tomato', 'Tomatoes', '🍅', '/kg', 4_000, 2_500, 24),
  I('th-oni', 'onion', 'Onions', '🧅', '/kg', 3_500, 2_000, 30),
  I('th-pot', 'potato', 'Potatoes', '🥔', '/kg', 3_500, 2_200, 40),
  I('th-cori', 'coriander', 'Coriander', '🌿', '/bunch', 2_000, 1_000, 12),
  I('th-lem', 'lemon', 'Lemons', '🍋', '/piece', 1_000, 500, 60),
  I('th-chi', 'chilli', 'Green chillies', '🌶️', '/bunch', 2_500, 1_200, 20),
  I('th-spi', 'spinach', 'Spinach', '🥬', '/bunch', 2_000, 1_000, 18),
];

const kirana: InventoryItem[] = [
  I('ki-att', 'atta', 'Whole-wheat atta', '🌾', '/5kg', 29_000, 24_000, 12),
  I('ki-rice', 'rice', 'Basmati rice', '🍚', '/kg', 12_000, 9_500, 20),
  I('ki-oil', 'oil', 'Mustard oil', '🛢️', '/L', 18_000, 15_000, 10),
  I('ki-dal', 'dal', 'Toor dal', '🫘', '/kg', 15_000, 12_000, 16),
  I('ki-milk', 'milk', 'Milk', '🥛', '/L', 6_000, 5_000, 14),
  I('ki-sugar', 'sugar', 'Sugar', '🍬', '/kg', 4_500, 3_800, 25),
  I('ki-tea', 'tea', 'Tea', '🍵', '/250g', 16_000, 13_000, 15),
];

const fruit: InventoryItem[] = [
  I('fr-mango', 'mango', 'Alphonso mango', '🥭', '/dozen', 24_000, 18_000, 8),
  I('fr-ban', 'banana', 'Bananas', '🍌', '/dozen', 8_000, 6_000, 10),
  I('fr-apple', 'apple', 'Apples (Shimla)', '🍎', '/kg', 22_000, 16_000, 9),
  I('fr-grape', 'grapes', 'Grapes', '🍇', '/kg', 16_000, 12_000, 7),
  I('fr-pome', 'pomegranate', 'Pomegranate', '🫐', '/kg', 26_000, 20_000, 6),
];

// demo-01 (the seller's own stall) takes its products from the inventory store — see stores/inventory.ts.

// Barry and Magan stock their own copies of the common lines, with their own SKUs.
const barry: InventoryItem[] = thela.map((i) => ({ ...i, sku: 'ba-' + i.sku.slice(3) }));
const magan: InventoryItem[] = fruit.map((i) => ({ ...i, sku: 'ma-' + i.sku.slice(3) }));

export const SHOPS: Shop[] = [
  {
    id: 'thela-01',
    name: { en: 'Ramesh ka thela' },
    kind: 'thela',
    emoji: '🛺',
    x: 30,
    y: 35,
    lat: 31.2891,
    lng: 75.5975,
    distanceM: 120,
    persona: 'charmer',
    products: thela,
    bundle: { skus: ['th-tom', 'th-oni'], discountCents: 500 },
  },
  {
    id: 'kirana-01',
    name: { en: 'Meena kirana' },
    kind: 'kirana',
    emoji: '🏪',
    x: 60,
    y: 30,
    lat: 31.2879,
    lng: 75.5961,
    distanceM: 240,
    persona: 'stoic',
    products: kirana,
    bundle: { skus: ['ki-oil', 'ki-dal'], discountCents: 1_500 },
  },
  {
    id: 'fruit-01',
    name: { en: 'Fruit wala' },
    kind: 'fruit',
    emoji: '🍉',
    x: 45,
    y: 70,
    lat: 31.2896,
    lng: 75.5958,
    distanceM: 380,
    persona: 'storyteller',
    products: fruit,
  },
  {
    id: 'demo-01',
    name: { en: 'Demo ki Dukaan' },
    kind: 'kirana',
    emoji: '🏪',
    x: 50,
    y: 40,
    lat: 31.2884,
    lng: 75.5968,
    distanceM: 60,
    persona: 'charmer',
    products: [],
  },

  {
    id: 'barry-01',
    name: { en: 'Barry vegetable shop' },
    kind: 'thela',
    emoji: '🥬',
    x: 48,
    y: 52,
    lat: 31.288401,
    lng: 75.596924,
    distanceM: 0,
    persona: 'charmer',
    products: barry,
  },
  {
    id: 'magan-01',
    name: { en: 'Cherry fruit shop' },
    kind: 'fruit',
    emoji: '🍒',
    x: 56,
    y: 46,
    lat: 31.288527,
    lng: 75.597071,
    distanceM: 0,
    persona: 'storyteller',
    products: magan,
  },
];

/** comps library key ↔ the ~40 common items world. Only the seeded ones ship. */
export type ItemLib =
  | 'tomato' | 'onion' | 'potato' | 'coriander' | 'lemon' | 'chilli' | 'spinach'
  | 'atta' | 'rice' | 'oil' | 'dal' | 'milk' | 'sugar' | 'tea'
  | 'mango' | 'banana' | 'apple' | 'grapes' | 'pomegranate';

/** Median / p25 / p75 list price cents across the bazaar (seeded, deterministic). */
export const COMP_LIB: Record<ItemLib, { median: number; p25: number; p75: number }> = {
  tomato: { median: 4_000, p25: 3_200, p75: 4_800 },
  onion: { median: 3_500, p25: 3_000, p75: 4_000 },
  potato: { median: 3_500, p25: 3_000, p75: 4_500 },
  coriander: { median: 2_000, p25: 1_500, p75: 2_500 },
  lemon: { median: 1_000, p25: 800, p75: 1_200 },
  chilli: { median: 2_500, p25: 2_000, p75: 3_000 },
  spinach: { median: 2_000, p25: 1_500, p75: 2_500 },
  atta: { median: 29_000, p25: 26_000, p75: 32_000 },
  rice: { median: 12_000, p25: 10_500, p75: 14_000 },
  oil: { median: 18_000, p25: 16_500, p75: 20_000 },
  dal: { median: 15_000, p25: 13_000, p75: 17_000 },
  milk: { median: 6_000, p25: 5_500, p75: 6_500 },
  sugar: { median: 4_500, p25: 4_000, p75: 5_000 },
  tea: { median: 16_000, p25: 14_000, p75: 18_000 },
  mango: { median: 24_000, p25: 20_000, p75: 28_000 },
  banana: { median: 8_000, p25: 7_000, p75: 9_000 },
  apple: { median: 22_000, p25: 18_000, p75: 26_000 },
  grapes: { median: 16_000, p25: 13_000, p75: 19_000 },
  pomegranate: { median: 26_000, p25: 22_000, p75: 30_000 },
};

/* ------------------------- demo buyer history ------------------------- */

export interface HistoryMonth {
  label: string;
  spendCents: number;
  savedCents: number;
  baskets: number;
}

export const BUYER_HISTORY: HistoryMonth[] = [
  { label: 'Apr', spendCents: 1_240_000, savedCents: 230_000, baskets: 9 },
  { label: 'May', spendCents: 980_000, savedCents: 210_000, baskets: 7 },
  { label: 'Jun', spendCents: 1_470_000, savedCents: 310_000, baskets: 11 },
  { label: 'Jul', spendCents: 1_190_000, savedCents: 270_000, baskets: 8 },
  { label: 'Aug', spendCents: 1_620_000, savedCents: 390_000, baskets: 12 },
  { label: 'Sep', spendCents: 1_360_000, savedCents: 320_000, baskets: 10 },
];

export const SELLER_DAYS: Array<{ d: string; earnCents: number }> = [
  { d: 'Mon', earnCents: 1_180 },
  { d: 'Tue', earnCents: 1_420 },
  { d: 'Wed', earnCents: 1_060 },
  { d: 'Thu', earnCents: 1_580 },
  { d: 'Fri', earnCents: 1_340 },
  { d: 'Sat', earnCents: 1_940 },
  { d: 'Sun', earnCents: 1_720 },
];

/* ---------------------- scripted parallel-haggle lanes --------------------- */

export interface LaneScript {
  sku: string;
  events: ScriptedEvent[];
  /** mark a lane as eventually-no-deal via session.ended reason no_zopa */
  noDeal?: boolean;
  bundleTactic?: boolean;
}

type ScriptedEvent = { delayMs: number; ev: { t: string; [k: string]: unknown } };

/** Deterministic per-sku RNG so Playwright sees stable prices. */
export function seededRandom(seedStr: string): () => number {
  let h = 2166136261;
  for (const c of seedStr) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Haggling is about *what price*, not *whether* — the buyer already put this in
 * their basket, so the shop and the buyer always land on a number. The buyer's
 * offer rises each round, the shop's falls (never below its floor), and they
 * always meet: that gap closing is the whole show, not a chance of no sale.
 *
 * Events are enveloped exactly like the real backend's (`lib/events.ts`), so
 * this script and a real SSE stream drive the same reducer identically.
 */
export function buildScript(shop: Shop, item: InventoryItem): LaneScript {
  const rng = seededRandom(shop.id + '|' + item.sku);
  const comp = item.market ?? COMP_LIB[item.itemId];
  const median = comp.median;
  const floor = item.floorCents;
  const list = item.listCents;
  const shopStart = Math.round((list * (0.86 + rng() * 0.06)) / 100) * 100;
  const buyerStart = Math.max(100, Math.round((Math.min(median, shopStart) * (0.6 + rng() * 0.1)) / 100) * 100);
  const rounds = 3 + Math.floor(rng() * 2); // 3–4 paired rounds
  let shopOff = shopStart;
  let buyerOff = buyerStart;

  const negotiationId = `b-${item.sku}-${Math.random().toString(36).slice(2, 8)}`;
  let eventSeq = 0;
  let turnSeq = 0;
  const frame = (body: { t: string; [k: string]: unknown }) => ({
    v: 1,
    id: `${negotiationId}-${eventSeq}`,
    seq: eventSeq++,
    negotiationId,
    ts: new Date().toISOString(),
    audience: 'all',
    ...body,
  });
  const turn = (body: { actor: string; kind: string; priceCents?: number; message: string; tactic?: string }) =>
    frame({ t: 'turn', turn: { seq: turnSeq++, ...body } });

  const seq: ScriptedEvent[] = [
    {
      delayMs: 100,
      ev: frame({
        t: 'session.started',
        roundsMax: 8,
        persona: shop.persona,
        market: { medianCents: median, p25Cents: comp.p25, p75Cents: comp.p75, sampleCount: 0, source: 'seed' },
      }),
    },
    { delayMs: 1400, ev: turn({ actor: 'shop', kind: 'offer', priceCents: shopOff, message: 'for you', tactic: 'anchor' }) },
  ];
  for (let r = 0; r < rounds; r++) {
    // the buyer closes part of the gap upward, the shop closes part of it downward, never below floor
    buyerOff = Math.min(shopOff, Math.round((buyerOff + (shopOff - buyerOff) * (0.4 + rng() * 0.15)) / 100) * 100);
    seq.push({ delayMs: 900, ev: turn({ actor: 'buyer', kind: 'counter', priceCents: buyerOff, message: 'market says lower' }) });
    shopOff = Math.max(floor, buyerOff, Math.round((shopOff - (shopOff - Math.max(buyerOff, floor)) * (0.35 + rng() * 0.15)) / 100) * 100);
    seq.push({ delayMs: 900, ev: turn({ actor: 'shop', kind: 'counter', priceCents: shopOff, message: 'final for regular', tactic: r === rounds - 1 ? 'final-offer' : 'market-cite' }) });
  }
  const agreed = Math.max(floor, Math.round(((buyerOff + shopOff) / 2) / 100) * 100);
  seq.push({ delayMs: 1100, ev: turn({ actor: 'buyer', kind: 'accept', priceCents: agreed, message: 'deal', tactic: 'bundle' }) });
  seq.push({ delayMs: 400, ev: frame({ t: 'deal.agreed', priceCents: agreed, currency: 'INR' }) });
  return { sku: item.sku, events: seq, noDeal: false };
}

/**
 * "Haggle everything" script — one lane per cart line, same run.
 */
export function buildCartScript(shop: Shop, lines: Array<{ item: InventoryItem; qty: number }>): LaneScript[] {
  return lines.map(({ item }) => buildScript(shop, item));
}

export const DEMO_USER = {
  name: 'Reema',
  phone: '+91 98765 43210',
  avatarEmoji: '🙍🏽‍♀️',
};