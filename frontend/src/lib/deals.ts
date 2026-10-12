/**
 * Mock deals for the ledger + Simple Mode earnings. Deterministic, derived from
 * "today" so the demo always looks alive. Replaced by the backend later.
 */

export interface Deal {
  id: string;
  item: string;
  emoji: string;
  listCents: number;
  soldCents: number;
  ts: string;
}

const DAY = 86_400_000;

function at(daysAgo: number, hour: number): string {
  const d = new Date();
  d.setHours(hour, 24 * (daysAgo % 3), 0, 0);
  return new Date(d.getTime() - daysAgo * DAY).toISOString();
}

const SEED: Array<[string, string, number, number, number, number]> = [
  ['Tomatoes (1 kg)', '🍅', 4000, 3400, 0, 9],
  ['Onions (1 kg)', '🧅', 3200, 3000, 0, 11],
  ['Potatoes (1 kg)', '🥔', 2800, 2600, 0, 13],
  ['Coriander (bunch)', '🌿', 800, 700, 0, 16],
  ['Lemons (4)', '🍋', 1200, 1000, 0, 18],
  ['Tomatoes (1 kg)', '🍅', 4000, 3600, 1, 10],
  ['Green chillies (100 g)', '🌶️', 900, 800, 1, 12],
  ['Onions (1 kg)', '🧅', 3200, 3100, 1, 15],
  ['Spinach (bunch)', '🥬', 1000, 900, 2, 9],
  ['Potatoes (2 kg)', '🥔', 5200, 4800, 2, 17],
  ['Lemons (8)', '🍋', 2200, 2000, 3, 11],
  ['Tomatoes (1 kg)', '🍅', 4000, 3500, 4, 14],
  ['Coriander (bunch)', '🌿', 800, 800, 5, 10],
  ['Onions (1 kg)', '🧅', 3200, 2900, 6, 18],
];

export const DEALS: Deal[] = SEED.map(([item, emoji, listCents, soldCents, daysAgo, hour], i) => ({
  id: `D-${1000 + i}`,
  item,
  emoji,
  listCents,
  soldCents,
  ts: at(daysAgo, hour),
}));

function isSameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
  );
}

export function dealsOn(ref: Date = new Date()): Deal[] {
  return DEALS.filter((d) => isSameDay(d.ts, ref));
}

export function totalCents(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + d.soldCents, 0);
}

export interface DayBar {
  label: string;
  totalCents: number;
}

/** Last 7 days, oldest → today. */
export function last7Days(): DayBar[] {
  const fmt = new Intl.DateTimeFormat('en', { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => {
    const daysAgo = 6 - i;
    const ref = new Date(Date.now() - daysAgo * DAY);
    const dayDeals = dealsOn(ref);
    return { label: fmt.format(ref), totalCents: totalCents(dayDeals) };
  });
}
