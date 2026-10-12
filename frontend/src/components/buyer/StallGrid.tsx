import { useMemo, useState } from 'react';
import { useCart } from '@/stores/cart';
import { useSession } from '@/stores/session';
import { useVenue, isOpen } from '@/stores/venue';
import { useLiveShops } from '@/stores/inventory';
import { formatMoney } from '@/lib/money';
import { compsOf } from '@/lib/mock/market';
import { roundQty, stepForLabel, UNITS } from '@/lib/units';
import { cn } from '@/lib/cn';
import type { InventoryItem } from '@/lib/mock/seeds';

/** One stall: products as price cards, closed state, bundle deal, and a sticky basket bar. */
export default function StallGrid({ id }: { id?: string }) {
  // Static build: the id is in the URL at runtime only, so read it on the client.
  const [stallId] = useState(() => id || (typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('id') ?? ''));
  const [q, setQ] = useState('');
  const shops = useLiveShops();
  const shop = shops.find((s) => s.id === stallId);
  const open = useVenue((s) => (shop ? isOpen(s.stalls, shop.id) : false));
  const cart = useCart();
  const session = useSession();
  const qty = (sku: string) => cart.lines.find((l) => l.sku === sku)?.qty ?? 0;

  const count = useMemo(() => cart.lines.reduce((s2, l) => s2 + l.qty, 0), [cart.lines]);
  const total = useMemo(() => cart.totalCents(), [cart.lines]);

  const add = (item: InventoryItem) => {
    if (!open) return;
    cart.add({
      sku: item.sku,
      shopId: stallId,
      title: item.title,
      emoji: item.emoji,
      unit: item.unit,
      listCents: item.listCents,
      qty: 1, // first tap is one whole unit; the stepper handles fractions after that
      stock: item.stock,
    });
  };

  const filteredProducts = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || !shop) return shop?.products ?? [];
    return shop.products.filter((p) => p.title.en.toLowerCase().includes(term));
  }, [shop, q]);

  if (!shop) {
    return (
      <div role="alert" className="surface grid gap-4 p-8 text-center">
        <p className="t-h2">We couldn't find that stall.</p>
        <a href="/app/buy" className="btn btn-primary mx-auto">Back to nearby stalls</a>
      </div>
    );
  }

  return (
    <div className="grid gap-6 pb-40">
      {/* stall header */}
      <header className="surface-accent flex flex-wrap items-center gap-4 p-5 sm:p-7">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-paper/70 text-4xl shadow-sm" aria-hidden="true">{shop.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="t-label !text-[#5b3200]">{shop.kind} · {shop.distanceM} m · {session.activeRole === 'buyer' ? 'buyer view' : 'seller view'}</p>
          <h1 className="t-h1 !text-[#23180a]">{shop.name.en}</h1>
        </div>
        <span className={cn('pill', open ? 'bg-paper/80 text-teal' : 'bg-paper/80 text-chili')}>{open ? '● Open now' : '● Closed'}</span>
      </header>

      {!open && (
        <div role="status" className="surface flex items-start gap-3 border-chili/40 bg-chili/10 p-4">
          <span className="text-xl" aria-hidden="true">🔒</span>
          <p className="text-sm text-ink">
            <b className="font-semibold">Closed right now.</b> You can look around. Add unlocks when the stall reopens.
          </p>
        </div>
      )}

      {shop.bundle && (
        <div className="surface flex items-center gap-3 border-teal/40 bg-teal/10 p-4">
          <span className="text-2xl" aria-hidden="true">🎁</span>
          <p className="text-sm text-ink">
            <b className="font-semibold">Bundle:</b> {shop.bundle.skus.map((k) => shop.products.find((p) => p.sku === k)?.emoji).join(' + ')} together save{' '}
            <span className="t-num font-semibold">{formatMoney(shop.bundle.discountCents)}</span>
          </p>
        </div>
      )}

      {shop.products.length > 0 && (
        <label className="relative block">
          <span className="sr-only">Search items</span>
          <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-ink-faint" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items…"
            className="field min-h-12 w-full pl-11"
          />
        </label>
      )}

      {shop.products.length === 0 ? (
        <p className="surface p-8 text-center text-ink-muted">Nothing in stock today. Check back soon.</p>
      ) : filteredProducts.length === 0 ? (
        <p className="surface p-8 text-center text-ink-muted">No items match "{q}".</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" aria-label="Products">
          {filteredProducts.map((item, i) => {
            const n = qty(item.sku);
            const m = compsOf(item);
            const step = stepForLabel(item.unit);
            const cheaper = item.listCents > m.medianCents;
            const low = item.stock <= 12;
            const unitLabel = item.unit.replace('/', '');
            return (
              <li
                key={item.sku}
                className={cn('surface rise flex flex-col gap-3 p-4 transition hover:-translate-y-0.5', i % 2 ? 'rise-2' : '')}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-paper-3 text-3xl" aria-hidden="true">{item.emoji}</span>
                  {low && <span className="pill pill-chili">Only {roundQty(item.stock)} left</span>}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold leading-snug text-ink">{item.title.en}</p>
                  <p className="text-xs text-ink-muted">per {unitLabel}</p>
                </div>
                <div className="grid gap-1">
                  <span className="price-tag w-fit !text-base sm:!text-lg">{formatMoney(item.listCents)}</span>
                  <p className={cn('text-xs font-semibold', cheaper ? 'text-chili' : 'text-teal')}>
                    {cheaper ? `Above market ${formatMoney(m.medianCents)}` : `Below market ${formatMoney(m.medianCents)}`}
                  </p>
                </div>

                {n === 0 ? (
                  <button type="button" onClick={() => add(item)} disabled={!open} className="btn btn-primary mt-auto !min-h-11 w-full">
                    Add
                  </button>
                ) : (
                  <div className="mt-auto flex items-center justify-between rounded-2xl bg-paper-3 p-1" role="group" aria-label={`Quantity of ${item.title.en}`}>
                    <StepBtn label="−" onClick={() => cart.setQty(item.sku, roundQty(n - step))} />
                    <span className="t-num text-base font-semibold text-ink">
                      {roundQty(n)} <span className="text-xs font-medium text-ink-muted">{UNITS[unitLabel as keyof typeof UNITS]?.label ?? ''}</span>
                    </span>
                    <StepBtn label="+" disabled={!open} onClick={() => cart.setQty(item.sku, roundQty(n + step))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* basket bar: thumb reach, above the bottom nav */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 px-4 sm:bottom-24">
          <div className="mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-ink p-3 pl-4 shadow-2xl">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-paper/60">{count} items</p>
              <p className="t-num text-xl font-semibold text-paper">{formatMoney(total)}</p>
            </div>
            <a href="/app/cart" className="btn btn-primary !min-h-12">View basket →</a>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'Add one' : 'Remove one'}
      className="grid h-11 w-11 place-items-center rounded-xl bg-paper text-xl font-semibold text-ink shadow-sm transition active:scale-95 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
