import { useInventory } from '@/stores/inventory';
import { isLow } from '@/lib/inventory';

/** Live stock counts for the stall page. The full list lives on /inventory. */
export default function StockSummary() {
  const items = useInventory((s) => s.items);
  const active = items.filter((i) => !i.archived);
  const low = active.filter(isLow).length;
  const out = active.filter((i) => i.qty === 0).length;
  return (
    <a href="/app/seller/inventory" className="flex min-h-16 items-center justify-between gap-4 surface p-4 active:scale-[0.99]">
      <div>
        <p className="font-semibold text-ink">{active.length} items on your stall</p>
        <p className="text-sm text-ink-muted">
          {low} low · {out} out · out-of-stock items hide from buyers
        </p>
      </div>
      <span className="whitespace-nowrap rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-paper">Manage →</span>
    </a>
  );
}
