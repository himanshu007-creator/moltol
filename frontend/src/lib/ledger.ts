/**
 * Ledger intelligence: pure functions over the deal history and the stock.
 * Each formula is listed in docs/BE_HANDOFF.md §7, so the BE can own the same
 * numbers later. Money is integer paise; quantities are in each item's unit.
 */
import type { StockItem } from '@/lib/inventory';
import { seededRandom } from '@/lib/mock/seeds';
import { UNITS } from '@/lib/units';

export interface Deal {
  id: string;
  /** epoch ms */
  ts: number;
  sku: string;
  /** buyer's first name only (privacy) */
  buyer: string;
  won: boolean;
  qty: number;
  /** agreed price per unit, paise (only meaningful when won) */
  pricePerUnitCents: number;
}

export interface ItemRow {
  sku: string;
  name: string;
  emoji: string;
  unit: string;
  stock: number;
  lowStockAt: number;
  archived: boolean;
  listCents: number;
  minCents: number;
  costCents: number;
  /** units sold in all history */
  unitsSold: number;
  /** units sold in the last DEAD_STOCK_DAYS, used for daily rates */
  unitsSold14: number;
  revenueCents: number;
  profitCents: number;
  /** profit / revenue, percent */
  marginPct: number;
  /** agreed revenue / list revenue, percent. 100 = sold at sticker. */
  listKeptPct: number;
  lastSoldTs: number | null;
  won: number;
  lost: number;
}

export interface Bucket {
  label: string;
  revenueCents: number;
  profitCents: number;
}

export interface Hint {
  id: string;
  kind: 'restock' | 'min_down' | 'min_up';
  sku: string;
  headline: string;
  reason: string;
  /** one-tap action; the UI applies it through the inventory store */
  action: { label: string; patch?: { minCents?: number }; restock?: number };
}

export interface Ledger {
  kpis: { revenueCents: number; profitCents: number; marginPct: number; listKeptPct: number; won: number; lost: number; winRatePct: number };
  rows: ItemRow[];
  mostSold: ItemRow[];
  leastSold: ItemRow[];
  highestProfit: ItemRow[];
  lowestMargin: ItemRow[];
  deadStock: ItemRow[];
  lowStock: ItemRow[];
  byDay: Bucket[];
  byWeek: Bucket[];
  byMonth: Bucket[];
  peakHours: Array<{ hour: number; deals: number }>;
  repeatCustomers: Array<{ first: string; visits: number; spentCents: number }>;
  hints: Hint[];
}

const DAY = 86_400_000;
export const DEAD_STOCK_DAYS = 14;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the week containing ts. */
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7;
  return d.getTime() - dow * DAY;
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

/** Won deals summed into the last `count` periods, oldest first. `start` maps a time to its period start. */
function bucketize(
  items: Map<string, StockItem>,
  deals: Deal[],
  now: number,
  start: (ts: number) => number,
  count: number,
  fmt: (t: number) => string,
): Bucket[] {
  const starts: number[] = [];
  let t = start(now);
  for (let i = 0; i < count; i++) {
    starts.unshift(t);
    t = start(t - 1); // any time just before this period starts the previous one
  }
  const out: Bucket[] = starts.map((s) => ({ label: fmt(s), revenueCents: 0, profitCents: 0 }));
  for (const d of deals) {
    const it = items.get(d.sku);
    if (!d.won || !it) continue;
    const idx = starts.findIndex((s, i) => d.ts >= s && d.ts < (starts[i + 1] ?? Infinity));
    if (idx < 0) continue;
    out[idx]!.revenueCents += Math.round(d.pricePerUnitCents * d.qty);
    out[idx]!.profitCents += Math.round((d.pricePerUnitCents - it.costCents) * d.qty);
  }
  return out;
}

const dayLabel = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthLabel = (t: number) => new Date(t).toLocaleDateString('en-IN', { month: 'short' });

export function computeLedger(items: StockItem[], deals: Deal[], now = Date.now()): Ledger {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const rowsAll: ItemRow[] = items.map((it) => {
    const mine = deals.filter((d) => d.sku === it.id);
    const won = mine.filter((d) => d.won);
    const unitsSold = won.reduce((s, d) => s + d.qty, 0);
    const unitsSold14 = won.filter((d) => now - d.ts <= DEAD_STOCK_DAYS * DAY).reduce((s, d) => s + d.qty, 0);
    const revenueCents = Math.round(won.reduce((s, d) => s + d.pricePerUnitCents * d.qty, 0));
    const listRevenue = Math.round(unitsSold * it.listCents);
    const profitCents = Math.round(won.reduce((s, d) => s + (d.pricePerUnitCents - it.costCents) * d.qty, 0));
    return {
      sku: it.id,
      name: it.name,
      emoji: it.emoji,
      unit: it.unit === 'custom' ? it.customUnit ?? 'unit' : UNITS[it.unit].label,
      stock: it.qty,
      lowStockAt: it.lowStockAt,
      archived: it.archived,
      listCents: it.listCents,
      minCents: it.minCents,
      costCents: it.costCents,
      unitsSold,
      unitsSold14,
      revenueCents,
      profitCents,
      marginPct: pct(profitCents, revenueCents),
      listKeptPct: pct(revenueCents, listRevenue),
      lastSoldTs: won.length ? Math.max(...won.map((d) => d.ts)) : null,
      won: won.length,
      lost: mine.length - won.length,
    };
  });
  const rows = rowsAll.filter((r) => !r.archived);

  const won = deals.filter((d) => d.won);
  const wonCount = won.length;
  const revenueCents = rows.reduce((s, r) => s + r.revenueCents, 0);
  const profitCents = rows.reduce((s, r) => s + r.profitCents, 0);
  const listRevenue = rows.reduce((s, r) => s + r.listCents * r.unitsSold, 0);
  const kpis = {
    revenueCents,
    profitCents,
    marginPct: pct(profitCents, revenueCents),
    listKeptPct: pct(revenueCents, listRevenue),
    won: wonCount,
    lost: deals.length - wonCount,
    winRatePct: pct(wonCount, deals.length),
  };

  const sortBy = (k: (r: ItemRow) => number, dir: 1 | -1 = -1) => [...rows].sort((a, b) => dir * (k(a) - k(b))).slice(0, 3);
  const recent = (r: ItemRow) => r.lastSoldTs ?? 0;
  const deadStock = rows.filter((r) => r.stock > 0 && (r.lastSoldTs == null || now - recent(r) > DEAD_STOCK_DAYS * DAY));
  const lowStock = rows.filter((r) => r.stock <= r.lowStockAt);

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, deals: 0 }));
  for (const d of won) hours[new Date(d.ts).getHours()]!.deals++;
  const peakHours = [...hours].sort((a, b) => b.deals - a.deals).slice(0, 3);

  const spend = new Map<string, { visits: number; spentCents: number }>();
  for (const d of won) {
    const s = spend.get(d.buyer) ?? { visits: 0, spentCents: 0 };
    s.visits++;
    s.spentCents += Math.round(d.pricePerUnitCents * d.qty);
    spend.set(d.buyer, s);
  }
  const repeatCustomers = [...spend.entries()]
    .filter(([, s]) => s.visits >= 2)
    .sort((a, b) => b[1].spentCents - a[1].spentCents)
    .slice(0, 5)
    .map(([first, s]) => ({ first, ...s }));

  return {
    kpis,
    rows,
    mostSold: sortBy((r) => r.revenueCents),
    leastSold: sortBy((r) => r.revenueCents, 1),
    highestProfit: sortBy((r) => r.profitCents),
    lowestMargin: sortBy((r) => r.marginPct, 1),
    deadStock,
    lowStock,
    byDay: bucketize(byId, deals, now, startOfDay, 14, dayLabel),
    byWeek: bucketize(byId, deals, now, startOfWeek, 8, dayLabel),
    byMonth: bucketize(byId, deals, now, startOfMonth, 6, monthLabel),
    peakHours,
    repeatCustomers,
    hints: hintsFor(rows, byId),
  };
}

/** Restock and lowest-price hints. Each carries a reason and one tap to apply. */
function hintsFor(rows: ItemRow[], byId: Map<string, StockItem>): Hint[] {
  const out: Hint[] = [];
  for (const r of rows) {
    const it = byId.get(r.sku);
    if (!it) continue;
    // restock: selling about (units sold in 14 days / 14) per day
    const perDay = r.unitsSold14 / DEAD_STOCK_DAYS;
    if (perDay > 0 && it.qty / perDay < 3) {
      const days = Math.max(0, Math.floor(it.qty / perDay));
      const add = Math.max(1, Math.round(perDay * 7 * 10) / 10);
      out.push({
        id: `restock-${r.sku}`,
        kind: 'restock',
        sku: r.sku,
        headline: `Restock ${r.name}`,
        reason: `${it.qty} ${r.unit} left and selling about ${Math.round(perDay * 10) / 10} a day: about ${days} day${days === 1 ? '' : 's'} of stock.`,
        action: { label: `Add ${add} ${r.unit} (1 week)`, restock: add },
      });
    }
    // price: won most deals at the floor → raise; lost most deals → lower
    const total = r.won + r.lost;
    if (total >= 4) {
      const winRate = r.won / total;
      const floorStep = Math.max(it.costCents, Math.round(it.minCents * 0.97));
      const raised = Math.min(it.listCents, Math.round(it.minCents * 1.03));
      if (winRate >= 0.85 && r.listKeptPct < 100) {
        out.push({
          id: `min-up-${r.sku}`,
          kind: 'min_up',
          sku: r.sku,
          headline: `Raise lowest price for ${r.name}`,
          reason: `You close ${Math.round(winRate * 100)}% of deals. Your lowest price can go up without losing many.`,
          action: { label: `Raise lowest to ${(raised / 100).toFixed(2)}`, patch: { minCents: raised } },
        });
      } else if (winRate < 0.5 && floorStep < it.minCents) {
        out.push({
          id: `min-down-${r.sku}`,
          kind: 'min_down',
          sku: r.sku,
          headline: `Lower lowest price for ${r.name}`,
          reason: `You close only ${Math.round(winRate * 100)}% of deals. A small drop may bring more buyers in.`,
          action: { label: `Lower lowest to ${(floorStep / 100).toFixed(2)}`, patch: { minCents: floorStep } },
        });
      }
    }
  }
  return out;
}

const BUYERS = ['Asha', 'Ravi', 'Sunita', 'Manpreet', 'Imran', 'Deepa', 'Kiran', 'Harjit', 'Neha', 'Vikram'];
const HOURS = [8, 9, 10, 11, 12, 13, 17, 18, 19, 20];

function qtyFor(unit: StockItem['unit'], r: () => number): number {
  switch (unit) {
    case 'kg':
    case 'litre':
      return 1 + Math.floor(r() * 4);
    case 'piece':
    case 'pack':
      return 1 + Math.floor(r() * 5);
    default:
      return 1 + Math.floor(r() * 2);
  }
}

/**
 * Deterministic demo history: `days` of deals per item, 90% of them in trading
 * hours. Same inputs, same output, so reloads and tests see the same ledger.
 */
export function seedDeals(items: StockItem[], now = Date.now(), days = 90): Deal[] {
  const out: Deal[] = [];
  for (let day = days - 1; day >= 0; day--) {
    const base = startOfDay(now - day * DAY);
    for (const it of items) {
      if (it.archived) continue;
      const r = seededRandom(`${it.id}|${base}`);
      const attempts = Math.floor(r() * 3) + (r() < 0.5 ? 1 : 0);
      for (let k = 0; k < attempts; k++) {
        const hour = HOURS[Math.floor(r() * HOURS.length)]!;
        const won = r() < 0.7;
        out.push({
          id: `d-${it.id}-${base}-${k}`,
          ts: base + hour * 3_600_000 + Math.floor(r() * 3_600_000),
          sku: it.id,
          buyer: BUYERS[Math.floor(r() * BUYERS.length)]!,
          won,
          qty: qtyFor(it.unit, r),
          // agreed between the lowest price and list
          pricePerUnitCents: Math.round(it.minCents + (it.listCents - it.minCents) * (0.2 + r() * 0.6)),
        });
      }
    }
  }
  return out;
}
