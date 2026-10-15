/**
 * Quantity rules shared by the API and the frontend. Quantities are not money:
 * mass and volume take up to 3 decimals (0.25 kg), everything else counts whole
 * items. A line's money is always `lineCents(unitCents, qty)` — one rounding, at
 * the end, the same way the frontend totals a cart.
 */

const DECIMAL_UNITS = new Set(["kg", "g", "litre", "liter", "l", "ml"]);

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace(/^\//, "");
}

/** Mass and volume units take fractional quantities; counts (piece, dozen, bunch, 500g packs…) do not. */
export function allowsFraction(unit: string | null | undefined): boolean {
  return DECIMAL_UNITS.has(normalizeUnit(unit));
}

export function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

/** A buyable quantity: positive, whole for counts, at most 3 decimals for mass/volume. */
export function isValidQty(qty: number, unit: string | null | undefined): boolean {
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (allowsFraction(unit)) return Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6;
  return Number.isInteger(qty);
}

/** A stock level: like `isValidQty` but zero is allowed. */
export function isValidStock(qty: number, unit: string | null | undefined): boolean {
  return qty === 0 || isValidQty(qty, unit);
}

/**
 * Integer cents for a per-unit price times a quantity, rounded half-up once —
 * in integer arithmetic on thousandths of a unit, so 4550 × 0.69 is 3140, not
 * the 3139 a float multiply gives.
 */
export function lineCents(unitCents: number, qty: number): number {
  const milli = BigInt(Math.round(qty * 1000));
  return Number((BigInt(Math.round(unitCents)) * milli + 500n) / 1000n);
}
