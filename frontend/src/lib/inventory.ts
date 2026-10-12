/**
 * Vendor inventory: schema (source of truth for the BE handoff), price rules,
 * the three quick-add parsers (voice line, CSV, snap stand-in) and the view a
 * buyer gets. Money is integer paise everywhere.
 */
import { z } from 'zod';
import { formatMoney, parseMoneyToCents } from '@/lib/money';
import { UNIT_IDS, UNIT_WORDS, clampQty, type UnitId } from '@/lib/units';
import { COMP_LIB, type InventoryItem as BuyerItem, type ItemLib } from '@/lib/mock/seeds';

export const StockItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(30).default('general'),
  emoji: z.string().min(1).max(8).default('🛒'),
  /** small JPEG data URL from snap or upload (≤ 160 px) */
  photo: z.string().max(60_000).optional(),
  unit: z.enum(UNIT_IDS as [UnitId, ...UnitId[]]),
  customUnit: z.string().max(20).optional(),
  /** size of one pack in g or ml, only for pack/custom units (e.g. 100 g chilli pack) */
  packSize: z.number().positive().optional(),
  /** stock in `unit` */
  qty: z.number().nonnegative(),
  costCents: z.number().int().nonnegative(),
  /** seller-only red line. Never sent to the buyer view. */
  minCents: z.number().int().nonnegative(),
  listCents: z.number().int().positive(),
  lowStockAt: z.number().nonnegative().default(5),
  /** comps library key, when the item matches one we have market data for */
  compKey: z.string().optional(),
  archived: z.boolean().default(false),
  updatedAt: z.number(),
});
export type StockItem = z.infer<typeof StockItemSchema>;

export interface PriceCheck {
  minError?: string;
  listError?: string;
  /** margin on the lowest price, percent of the price */
  floorMarginPct: number;
  /** margin at list price, percent of the price */
  listMarginPct: number;
}

export function marginPct(price: number, cost: number): number {
  return price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
}

/** min >= cost and list >= min, with friendly messages for inline errors. */
export function checkPrices(p: { costCents: number; minCents: number; listCents: number }): PriceCheck {
  const out: PriceCheck = {
    floorMarginPct: marginPct(p.minCents, p.costCents),
    listMarginPct: marginPct(p.listCents, p.costCents),
  };
  if (p.minCents < p.costCents) {
    out.minError = `Lowest price is below what you paid (${formatMoney(p.costCents)}). You would lose money on every sale.`;
  }
  if (p.listCents < p.minCents) {
    out.listError = `List price should be at least your lowest price (${formatMoney(p.minCents)}).`;
  }
  return out;
}

/* ----------------------------- voice line ------------------------------ */

const FILLER = new Set(['of', 'ka', 'ki', 'ke', 'the', 'aur', 'and', 'hai', 'hain', 'ek', 'a', 'per', 'rate', 'me', 'mein']);
const PRICE_RE = /(\d+(?:\.\d+)?)\s*(?:rupay(?:a|e|en)?|rupees?|rs\.?|₹)\s*(?:per\s+|a\s+|ek\s+)?([a-z]+)?/i;

export interface VoiceDraft {
  name: string;
  qty: number;
  unit: UnitId;
  /** list price per `unit`, if spoken */
  listCents?: number;
}

/**
 * "20 kilo tamatar, 30 rupaye kilo" -> { name: 'tamatar', qty: 20, unit: 'kg', listCents: 3000 }
 * Returns null when no name is found. Caller shows the result for confirmation.
 */
export function parseVoiceLine(input: string): VoiceDraft | null {
  let rest = input.toLowerCase().replace(/[,.;]/g, ' ');
  let listCents: number | undefined;
  let priceUnit: UnitId | undefined;

  const price = rest.match(PRICE_RE);
  if (price) {
    listCents = Math.round(Number(price[1]) * 100);
    priceUnit = price[2] ? UNIT_WORDS[price[2]] : undefined;
    rest = rest.replace(price[0], ' ');
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  let qty = 1;
  const qi = tokens.findIndex((t) => /^\d+(\.\d+)?$/.test(t));
  if (qi >= 0) {
    qty = Number(tokens[qi]);
    tokens.splice(qi, 1);
  }
  let unit: UnitId = priceUnit ?? 'piece';
  const ui = tokens.findIndex((t) => UNIT_WORDS[t]);
  if (ui >= 0) {
    unit = UNIT_WORDS[tokens[ui] ?? ''] ?? unit;
    tokens.splice(ui, 1);
  }

  const name = tokens.filter((t) => !FILLER.has(t)).join(' ').trim();
  if (!name) return null;
  return { name: capitalise(name), qty: clampQty(qty, unit), unit, listCents };
}

function capitalise(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* -------------------------------- CSV ---------------------------------- */

/** Minimal RFC-4180 reader: quoted cells, doubled quotes, CRLF. Drops blank lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export const CSV_FIELDS = ['name', 'category', 'qty', 'unit', 'cost', 'min', 'list', 'lowStock'] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

export const CSV_LABELS: Record<CsvField, string> = {
  name: 'Name',
  category: 'Category',
  qty: 'Quantity',
  unit: 'Unit',
  cost: 'Cost price',
  min: 'Lowest price',
  list: 'List price',
  lowStock: 'Low-stock alert at',
};

const ALIASES: Record<CsvField, string[]> = {
  name: ['name', 'item', 'product', 'item name'],
  category: ['category', 'cat', 'type'],
  qty: ['qty', 'quantity', 'stock'],
  unit: ['unit', 'uom'],
  cost: ['cost', 'cost price', 'buy', 'buy price'],
  min: ['min', 'minimum', 'lowest', 'lowest price', 'floor'],
  list: ['list', 'list price', 'price', 'sell', 'sell price', 'mrp'],
  lowStock: ['low stock', 'low', 'threshold', 'reorder'],
};

/** Column index per field, or -1 when unmapped. Matches headers to aliases. */
export function guessMapping(headers: string[]): Record<CsvField, number> {
  const norm = headers.map((h) => h.toLowerCase().trim());
  const out = {} as Record<CsvField, number>;
  for (const f of CSV_FIELDS) out[f] = norm.findIndex((h) => ALIASES[f].includes(h));
  return out;
}

export type StockDraft = Omit<StockItem, 'id' | 'archived' | 'updatedAt'>;

export interface CsvRow {
  line: number;
  draft?: StockDraft;
  errors: string[];
}

/** Validate every data row against the mapping. Rows with errors are shown, not imported. */
export function rowsToDrafts(rows: string[][], map: Record<CsvField, number>): CsvRow[] {
  return rows.map((r, i) => {
    const get = (f: CsvField) => (map[f] >= 0 ? (r[map[f]] ?? '') : '');
    const errors: string[] = [];

    const name = get('name');
    if (!name) errors.push('Missing name');

    const unitText = get('unit').toLowerCase();
    const unit = (unitText ? UNIT_WORDS[unitText] : undefined) ?? 'piece';
    if (unitText && !UNIT_WORDS[unitText]) errors.push(`Unknown unit "${unitText}"`);

    const qty = Number(get('qty') || 0);
    if (!Number.isFinite(qty) || qty < 0) errors.push('Quantity is not a number');

    const money = (s: string) => (s ? parseMoneyToCents(s) : null);
    const cost = money(get('cost'));
    const min = money(get('min'));
    const list = money(get('list'));
    if (cost == null) errors.push('Cost price missing or not a number');
    if (min == null) errors.push('Lowest price missing or not a number');
    if (list == null) errors.push('List price missing or not a number');

    if (cost != null && min != null && list != null) {
      const prices = checkPrices({ costCents: cost, minCents: min, listCents: list });
      if (prices.minError) errors.push('Lowest price is below cost');
      if (prices.listError) errors.push('List price is below lowest price');
    }
    if (errors.length || cost == null || min == null || list == null) return { line: i + 2, errors };

    const lowRaw = get('lowStock');
    return {
      line: i + 2,
      errors,
      draft: {
        name,
        category: get('category') || 'general',
        emoji: '🛒',
        unit,
        qty: clampQty(qty, unit),
        costCents: cost,
        minCents: min,
        listCents: list,
        lowStockAt: lowRaw && Number.isFinite(Number(lowRaw)) ? Number(lowRaw) : 5,
      },
    };
  });
}

/* ---------------------------- snap stand-in ---------------------------- */

/**
 * Canned vision suggestions. Stand-in for camera detection: the user confirms
 * or edits. A real backend would call a vision model (SerpAPI Lens is an option).
 */
export const SNAP_SUGGESTIONS: Array<Pick<StockDraft, 'name' | 'category' | 'emoji' | 'unit' | 'listCents' | 'compKey'>> = [
  { name: 'Tomatoes', category: 'vegetable', emoji: '🍅', unit: 'kg', listCents: 4000, compKey: 'tomato' },
  { name: 'Onions', category: 'vegetable', emoji: '🧅', unit: 'kg', listCents: 3500, compKey: 'onion' },
  { name: 'Coriander', category: 'vegetable', emoji: '🌿', unit: 'bunch', listCents: 2000, compKey: 'coriander' },
];

/* ---------------------------- buyer view ------------------------------ */

/**
 * What a buyer sees for the demo stall: only in-stock, non-archived items.
 * `floorCents` is intentionally set to the seller's minimum for the negotiation
 * engine only. The buyer UI never renders it (see the cross-cutting rule).
 */
export function toBuyerItems(items: StockItem[]): BuyerItem[] {
  return items
    .filter((i) => !i.archived && i.qty > 0)
    .map((i) => ({
      sku: i.id,
      itemId: (i.compKey ?? 'tomato') as ItemLib, // fallback only for the library-keyed helpers; `market` is authoritative
      title: { en: i.name, hi: i.name, pa: i.name },
      emoji: i.emoji,
      unit: `/${i.unit === 'custom' ? i.customUnit ?? 'unit' : i.unit}`,
      listCents: i.listCents,
      floorCents: i.minCents,
      stock: i.qty,
      market: marketBand(i),
    }));
}

/** Market band for a stock item: comps library when matched, otherwise a band around the list price. */
export function marketBand(i: StockItem): NonNullable<BuyerItem['market']> {
  const lib = i.compKey ? COMP_LIB[i.compKey as ItemLib] : undefined;
  if (lib) return lib;
  return { median: i.listCents, p25: Math.round(i.listCents * 0.85), p75: Math.round(i.listCents * 1.1) };
}

/** Low stock: in stock, at or below the alert threshold. */
export function isLow(i: StockItem): boolean {
  return !i.archived && i.qty > 0 && i.qty <= i.lowStockAt;
}
