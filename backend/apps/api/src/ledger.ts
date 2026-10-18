import { formatCents, lineCents } from "@moltol/contracts";
import type {
  BuyerInsightCard,
  BuyerInsights,
  Ledger,
  LedgerBucket,
  LedgerFunnelStage,
  LedgerKpis,
  LedgerPeriod,
  LedgerRow,
  LedgerWidgets,
  LedgerWindow,
  Negotiation,
} from "@moltol/contracts";
import type { BasketRow } from "@moltol/store";

/**
 * Pure ledger maths. The API feeds it rows; nothing here touches the network or
 * the sealed vault, so it is cheap to unit-test and safe to run on every read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve a period to a concrete window. `from` is null for "all". */
export function windowFor(period: LedgerPeriod, now = Date.now()): LedgerWindow {
  const to = new Date(now).toISOString();
  if (period === "all") return { period, from: null, to };
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return { period, from: new Date(now - days * DAY_MS).toISOString(), to };
}

/** A line's terminal states — mirrors `views.ts`'s `isTerminal`, without importing it. */
const TERMINAL = new Set(["agreed", "payment_pending", "paid", "revealed", "no_deal", "failed"]);

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export interface LedgerLineInput {
  negotiationId: string;
  basketId: string;
  ts: Date;
  currency: string;
  itemId: string | null;
  name: string;
  emoji: string | null;
  unit: string | null;
  qty: number;
  unitCents: number | null;
  listCents: number | null;
  floorCents: number | null;
  fairness: number | null;
  verified: boolean;
}

/** One ledger row, with every derived number computed in integer cents. */
export function toLedgerRow(line: LedgerLineInput): LedgerRow {
  const qty = line.qty;
  const list = line.listCents ?? line.unitCents ?? 0;
  const listLine = lineCents(list, qty);
  const won = line.unitCents !== null;
  const agreedLine = won ? lineCents(line.unitCents!, qty) : null;
  const floorLine = line.floorCents === null ? null : lineCents(line.floorCents, qty);
  const marginCents =
    won && floorLine !== null && agreedLine !== null ? agreedLine - floorLine : null;
  const discountPct = won && listLine > 0 ? pct(listLine - agreedLine!, listLine) : 0;
  return {
    id: line.negotiationId,
    ts: line.ts.toISOString(),
    basketId: line.basketId,
    itemId: line.itemId,
    name: line.name,
    emoji: line.emoji,
    unit: line.unit,
    qty,
    won,
    unitCents: line.unitCents,
    lineCents: agreedLine,
    listCents: list,
    listLineCents: listLine,
    floorCents: line.floorCents,
    floorLineCents: floorLine,
    marginCents,
    discountPct,
    fairness: line.fairness,
    proofVerified: line.verified,
    currency: line.currency,
  };
}

function computeKpis(rows: LedgerRow[]): LedgerKpis {
  const won = rows.filter((r) => r.won);
  const revenueCents = won.reduce((s, r) => s + (r.lineCents ?? 0), 0);
  const listCents = won.reduce((s, r) => s + r.listLineCents, 0);
  const marginKeptCents = won.reduce((s, r) => s + (r.marginCents ?? 0), 0);
  const unitsSold = won.reduce((s, r) => s + r.qty, 0);
  const fair = won.filter((r) => r.fairness !== null).map((r) => r.fairness!);
  const verified = won.filter((r) => r.proofVerified).length;
  return {
    deals: {
      total: rows.length,
      won: won.length,
      lost: rows.length - won.length,
      winRatePct: pct(won.length, rows.length),
    },
    unitsSold: Math.round(unitsSold * 1000) / 1000,
    revenueCents,
    listCents,
    savingsGivenCents: Math.max(0, listCents - revenueCents),
    marginKeptCents,
    avgDiscountPct: listCents > 0 ? pct(listCents - revenueCents, listCents) : 0,
    avgFairness: fair.length ? Math.round(fair.reduce((a, b) => a + b, 0) / fair.length) : null,
    proofVerifiedRatePct: pct(verified, won.length),
  };
}

function byItem(rows: LedgerRow[], pick: (r: LedgerRow) => number): LedgerWidgets["marginByItem"] {
  const map = new Map<string, { label: string; valueCents: number; count: number }>();
  for (const row of rows) {
    if (!row.won) continue;
    const entry = map.get(row.name) ?? { label: row.name, valueCents: 0, count: 0 };
    entry.valueCents += pick(row);
    entry.count += 1;
    map.set(row.name, entry);
  }
  return [...map.values()].sort((a, b) => b.valueCents - a.valueCents).slice(0, 8);
}

function fairnessHistogram(rows: LedgerRow[]): LedgerBucket[] {
  const buckets: LedgerBucket[] = [
    { label: "0–20", from: 0, to: 20, count: 0 },
    { label: "20–40", from: 20, to: 40, count: 0 },
    { label: "40–60", from: 40, to: 60, count: 0 },
    { label: "60–80", from: 60, to: 80, count: 0 },
    { label: "80–100", from: 80, to: 100, count: 0 },
  ];
  for (const row of rows) {
    if (!row.won || row.fairness === null) continue;
    const idx = Math.min(4, Math.floor(row.fairness / 20));
    buckets[idx]!.count += 1;
  }
  return buckets;
}

function dealFunnel(baskets: BasketRow[], lines: Negotiation[]): LedgerFunnelStage[] {
  const byBasket = new Map<string, Negotiation[]>();
  for (const line of lines) {
    if (!line.basketId) continue;
    (byBasket.get(line.basketId) ?? byBasket.set(line.basketId, []).get(line.basketId)!).push(line);
  }
  const settled = baskets.filter((b) => {
    const ls = byBasket.get(b.id) ?? [];
    return b.state !== "open" || (ls.length > 0 && ls.every((l) => TERMINAL.has(l.state)));
  }).length;
  const checkedOut = baskets.filter(
    (b) => b.state === "payment_pending" || b.state === "paid" || b.state === "failed",
  ).length;
  const paid = baskets.filter((b) => b.state === "paid").length;
  return [
    { stage: "created", label: "Baskets started", count: baskets.length },
    { stage: "settled", label: "All lanes closed", count: settled },
    { stage: "checked_out", label: "Reached checkout", count: checkedOut },
    { stage: "paid", label: "Paid", count: paid },
  ];
}

/** Assemble the full ledger response from raw rows and the shop's baskets. */
export function computeLedger(input: {
  window: LedgerWindow;
  currency: string;
  lines: LedgerLineInput[];
  baskets: BasketRow[];
  allLines: Negotiation[];
}): Ledger {
  const rows = input.lines.map(toLedgerRow);
  return {
    window: input.window,
    currency: input.currency,
    kpis: computeKpis(rows),
    widgets: {
      marginByItem: byItem(rows, (r) => r.marginCents ?? 0),
      revenueByItem: byItem(rows, (r) => r.lineCents ?? 0),
      fairnessHistogram: fairnessHistogram(rows),
      dealFunnel: dealFunnel(input.baskets, input.allLines),
    },
    rows,
  };
}

/* ----------------------------- buyer insights ----------------------------- */

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Consecutive calendar days with an order, ending today or yesterday. */
export function streakDays(dates: Date[], now = new Date()): number {
  const days = new Set(dates.map(dayKey));
  if (days.size === 0) return 0;
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!days.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function computeBuyerInsights(input: {
  orders: { ts: Date; lines: LedgerRow[]; shopId: string }[];
  currency?: string;
  now?: Date;
  budgetCents?: number | null;
}): BuyerInsights {
  const now = input.now ?? new Date();
  const currency = input.currency ?? "INR";
  const allLines = input.orders.flatMap((o) => o.lines);
  const won = allLines.filter((l) => l.won);
  const totalSpentCents = won.reduce((s, l) => s + (l.lineCents ?? 0), 0);
  const totalListCents = won.reduce((s, l) => s + l.listLineCents, 0);
  const totalSavedCents = Math.max(0, totalListCents - totalSpentCents);
  const fair = won.filter((l) => l.fairness !== null).map((l) => l.fairness!);
  const avgFairness = fair.length
    ? Math.round(fair.reduce((a, b) => a + b, 0) / fair.length)
    : null;
  const avgSavingsPct = totalListCents > 0 ? pct(totalSavedCents, totalListCents) : 0;
  const streak = streakDays(
    input.orders.map((o) => o.ts),
    now,
  );
  const shopCount = new Set(input.orders.map((o) => o.shopId)).size;
  const budgetCents = input.budgetCents ?? null;

  const money = (c: number) => formatCents(c, currency);
  const cards: BuyerInsightCard[] = [
    {
      kind: "savings",
      title: "Saved haggling",
      value: totalSavedCents,
      detail: `${money(totalSavedCents)} off sticker (${avgSavingsPct}% average).`,
    },
    {
      kind: "spend",
      title: "Total spent",
      value: totalSpentCents,
      detail: `${input.orders.length} order${input.orders.length === 1 ? "" : "s"} across ${shopCount} shop${shopCount === 1 ? "" : "s"}.`,
    },
    {
      kind: "streak",
      title: "Haggle streak",
      value: streak,
      detail: streak > 1 ? `${streak} days in a row.` : "Haggle again to start a streak.",
    },
  ];
  if (avgFairness !== null) {
    cards.push({
      kind: "fairness",
      title: "Fairness",
      value: avgFairness,
      detail: `Average proof fairness ${avgFairness}/100.`,
    });
  }
  if (budgetCents !== null && budgetCents > 0) {
    const remaining = Math.max(0, budgetCents - totalSpentCents);
    cards.push({
      kind: "budget",
      title: "Budget left",
      value: remaining,
      detail:
        remaining > 0 ? `${money(remaining)} left of ${money(budgetCents)}.` : "Budget used up.",
    });
  }
  return {
    orders: input.orders.length,
    totalSpentCents,
    totalListCents,
    totalSavedCents,
    avgSavingsPct,
    avgFairness,
    streakDays: streak,
    budgetCents,
    cards,
  };
}
