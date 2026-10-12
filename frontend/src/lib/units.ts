/**
 * Units for stock math and buyer carts. Every unit belongs to a family, and
 * `toBase` converts it to the family's base (g, ml, piece). Stock is stored in
 * the item's own unit; base quantities are only for comparing across units.
 */
export type UnitId = 'kg' | 'g' | 'litre' | 'ml' | 'piece' | 'dozen' | 'bunch' | 'pack' | 'custom';

export interface UnitDef {
  id: UnitId;
  label: string;
  family: 'mass' | 'volume' | 'count' | 'custom';
  /** how many base units (g / ml / piece) one of this unit is */
  toBase: number;
  /** smallest step a buyer can add to a cart */
  step: number;
}

export const UNITS: Record<UnitId, UnitDef> = {
  kg: { id: 'kg', label: 'kg', family: 'mass', toBase: 1000, step: 0.25 },
  g: { id: 'g', label: 'g', family: 'mass', toBase: 1, step: 100 },
  litre: { id: 'litre', label: 'litre', family: 'volume', toBase: 1000, step: 0.5 },
  ml: { id: 'ml', label: 'ml', family: 'volume', toBase: 1, step: 100 },
  piece: { id: 'piece', label: 'piece', family: 'count', toBase: 1, step: 1 },
  dozen: { id: 'dozen', label: 'dozen', family: 'count', toBase: 12, step: 1 },
  bunch: { id: 'bunch', label: 'bunch', family: 'count', toBase: 1, step: 1 },
  pack: { id: 'pack', label: 'pack', family: 'count', toBase: 1, step: 1 },
  custom: { id: 'custom', label: 'unit', family: 'custom', toBase: 1, step: 1 },
};

export const UNIT_IDS = Object.keys(UNITS) as UnitId[];

/** Spoken and typed words → unit. Covers English plus the Hindi/Punjabi-ish words shopkeepers say. */
export const UNIT_WORDS: Record<string, UnitId> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gram: 'g', grams: 'g',
  l: 'litre', ltr: 'litre', litre: 'litre', liter: 'litre', litres: 'litre',
  ml: 'ml',
  dozen: 'dozen', dozens: 'dozen', darjan: 'dozen',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', nag: 'piece', number: 'piece',
  bunch: 'bunch', bundle: 'bunch', gaddi: 'bunch',
  pack: 'pack', packet: 'pack', packets: 'pack',
};

/** Normalise a quantity to what the unit allows: weights/volumes take decimals, counts take whole numbers. */
export function clampQty(qty: number, unit: UnitId): number {
  if (!Number.isFinite(qty) || qty < 0) return 0;
  return UNITS[unit].family === 'mass' || UNITS[unit].family === 'volume'
    ? Math.round(qty * 1000) / 1000
    : Math.floor(qty);
}

/** Quantity in the family base (g / ml / piece), for stock math across units. */
export function toBase(qty: number, unit: UnitId): number {
  return qty * UNITS[unit].toBase;
}

/** Cents per `to` unit for a price quoted per `from` unit. Null when the families differ. */
export function convertPrice(priceCents: number, from: UnitId, to: UnitId): number | null {
  if (UNITS[from].family !== UNITS[to].family) return null;
  return Math.round((priceCents * UNITS[to].toBase) / UNITS[from].toBase);
}

/** "1.5 kg", "12 piece", "2 dozen". Uses the unit label, not an English plural. */
export function formatQty(qty: number, unit: UnitId, customLabel?: string): string {
  const label = unit === 'custom' && customLabel ? customLabel : UNITS[unit].label;
  return `${qty} ${label}`;
}

/** Buyer cart increment for a unit: 0.25 kg, 100 g, 0.5 litre, 100 ml, counts by 1. */
export function cartStep(unit: UnitId): number {
  return UNITS[unit].step;
}

/** Cart step for a buyer-facing unit label such as "/kg" or "/bunch". Unknown labels step by 1. */
export function stepForLabel(label: string): number {
  return UNITS[label.replace(/^\//, '') as UnitId]?.step ?? 1;
}

/** Keep cart quantities to three decimals so 0.25 + 0.25 stays exact. */
export function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}
