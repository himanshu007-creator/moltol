/**
 * Money is ALWAYS integer minor units (cents) + a currency code. Never floats.
 * (plan.md §10). All display goes through Intl so locale/currency stay honest.
 */
export type Cents = number;

const fmtCache = new Map<string, Intl.NumberFormat>();

function nf(currency: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = currency + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { style: 'currency', currency, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** $40.00 from 4000. */
export function formatMoney(cents: Cents, currency = 'INR'): string {
  return nf(currency, {}).format(cents / 100);
}

/** $40 (no trailing zeros churn) — for compact chips and axes. */
export function formatMoneyCompact(cents: Cents, currency = 'INR'): string {
  return nf(currency, { maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** "40" or "39.50" -> 4000 / 3950. Returns null on garbage (fail closed). */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Whole rupees for dashboards: ₹1,41,127. Paise stay in the data, not on the KPI tile. */
export function formatMoneyWhole(cents: Cents, currency = 'INR'): string {
  return nf(currency, { maximumFractionDigits: 0 }).format(Math.round(cents / 100));
}
