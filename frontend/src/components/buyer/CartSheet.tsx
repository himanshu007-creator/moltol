import { useMemo, useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useCart, type CartLine } from '@/stores/cart';
import { useBazaar } from '@/stores/bazaar';
import { useLiveShops } from '@/stores/inventory';
import { useRealShopProducts, useDirectShopFallback } from '@/stores/realShops';
import { useBuyer } from '@/stores/buyer';
import { formatMoney } from '@/lib/money';
import { requestFor, PRESETS, type PresetId } from '@/lib/personality';
import PersonalityPicker from '@/components/buyer/PersonalityPicker';
import { compsOf } from '@/lib/comps';
import { roundQty, stepForLabel } from '@/lib/units';
import type { InventoryItem } from '@/lib/types';

/**
 * The basket. Choose which items the agents haggle (all or selected), pick a
 * haggle style for this basket, then start. The saved style is only the default.
 */
export default function CartSheet() {
  const cart = useCart();
  const bazaar = useBazaar();
  const savedPersonality = useBuyer((s) => s.personality);
  const [preset, setPreset] = useState<PresetId>(savedPersonality);
  const shops = useLiveShops();
  const listShop = shops.find((s) => s.id === cart.shopId);
  // Same gap as StallGrid: a real shop's nearby-fetch is in-memory only, so a
  // fresh page load that lands straight on the cart (no discovery visit yet
  // this session) needs its own fetch — never silently fall back to a
  // different shop and haggle against the wrong catalogue.
  const directShop = useDirectShopFallback(cart.shopId ?? '', Boolean(listShop));
  const baseShop = listShop ?? directShop;
  const realProducts = useRealShopProducts(listShop); // directShop already carries its own products
  const shop = baseShop && realProducts ? { ...baseShop, products: realProducts } : baseShop;

  // Every basket line is always haggled — no partial selection.
  const included = cart.lines;
  const includedTotal = included.reduce((s, l) => s + Math.round(l.listCents * l.qty), 0);
  const maxPotential = useMemo(
    () =>
      !shop
        ? 0
        : included.reduce((s2, l) => {
            const m = compsOf(itemOf(l, shop));
            return s2 + Math.max(0, Math.round((l.listCents - m.p25Cents) * l.qty));
          }, 0),
    [included, shop],
  );

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const startHaggle = async () => {
    if (!included.length || !shop || starting) return;
    setStarting(true);
    setStartError(null);
    const lines = included.map((l) => ({ ...l, item: itemOf(l, shop) }));
    const request = requestFor(preset);
    // Awaited: the basket must actually exist before we navigate, or /app/bazaar
    // mounts onto a still-idle store and shows "No live haggle yet" forever.
    await bazaar.start(shop, lines, { scope: 'all', style: request.tone, budgetCents: null, request });
    const err = useBazaar.getState().error;
    if (err) {
      setStartError(err);
      setStarting(false);
      return;
    }
    // Soft nav (not location.href): a hard reload can outrun the async IndexedDB
    // write of the negotiation just started, so /app/bazaar hydrates stale/empty.
    void navigate('/app/bazaar');
  };

  if (!cart.lines.length) {
    return (
      <div className="surface grid justify-items-center gap-4 p-10 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-paper-3 text-4xl" aria-hidden="true">🧺</span>
        <div>
          <p className="t-h2">Your basket is empty</p>
          <p className="mt-1 text-ink-muted">Pick a stall and add a few things. Your agents will haggle them in parallel.</p>
        </div>
        <a href="/app/buy" className="btn btn-primary">Find stalls nearby</a>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="surface grid justify-items-center gap-4 p-10 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-paper-3 text-4xl" aria-hidden="true">⏳</span>
        <p className="t-h2">Finding your stall…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 pb-44">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-label">Your basket</p>
          <h1 className="t-h1 mt-1">{shop.name.en}</h1>
          <p className="mt-1 text-sm text-ink-muted">{cart.lines.length} items · your agent haggles all of them</p>
        </div>
        <span className="pill">{shop.emoji} {shop.kind}</span>
      </header>

      <ul className="grid gap-3" aria-label="Basket items">
        {cart.lines.map((l) => {
          const item = itemOf(l, shop);
          const m = compsOf(item);
          const saved = Math.max(0, l.listCents - m.medianCents);
          const step = stepForLabel(l.unit);
          return (
            <li key={l.sku} className="surface flex items-center gap-3 p-3 transition sm:gap-4 sm:p-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-paper-3 text-3xl" aria-hidden="true">{l.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{l.title.en}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {roundQty(l.qty)} × <span className="t-num">{formatMoney(l.listCents)}</span>
                  {saved > 0 && <span className="font-semibold text-teal"> · sticker is {formatMoney(saved)} over market</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-2xl bg-paper-3 p-1" role="group" aria-label={`Quantity of ${l.title.en}`}>
                <StepBtn label="−" onClick={() => cart.setQty(l.sku, roundQty(l.qty - step))} />
                <span className="t-num w-12 text-center text-sm font-semibold text-ink">{roundQty(l.qty)}</span>
                <StepBtn label="+" onClick={() => cart.setQty(l.sku, roundQty(l.qty + step))} />
              </div>
            </li>
          );
        })}
      </ul>

      <section className="surface grid gap-4 p-5" aria-labelledby="style-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="style-h" className="t-h2">Haggle style for this basket</h2>
          <span className="text-xs text-ink-muted">Changes only this basket</span>
        </div>
        <PersonalityPicker value={preset} onChange={setPreset} />
        <p className="text-xs text-ink-muted">
          Haggling all {cart.lines.length} items. {PRESETS[preset].label} keeps up to {PRESETS[preset].rounds} rounds per item.
        </p>
      </section>

      <section className="surface grid gap-2 p-5 text-sm" aria-label="Totals">
        <div className="flex justify-between text-ink-muted">
          <span>Sticker total (haggled items)</span>
          <span className="t-num text-ink">{formatMoney(includedTotal)}</span>
        </div>
        <div className="flex justify-between font-semibold text-teal">
          <span>Possible saving, rough estimate</span>
          <span className="t-num">{formatMoney(maxPotential)}</span>
        </div>
      </section>

      {/* sticky action bar, above the bottom nav */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 px-4 sm:bottom-24">
        <div className="mx-auto grid max-w-md gap-2">
          {startError && (
            <p role="alert" className="rounded-2xl bg-chili/15 px-4 py-2 text-sm font-medium text-chili">
              {startError}
            </p>
          )}
          <div className="flex items-center gap-3 rounded-3xl bg-ink p-3 pl-4 shadow-2xl">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-paper/60">Sticker, {included.length} items</p>
              <p className="t-num text-xl font-semibold text-paper">{formatMoney(includedTotal)}</p>
            </div>
            <a href="/app/buy" className="btn btn-quiet !min-h-12 !px-4 !text-sm">Browse</a>
            <button type="button" onClick={() => void startHaggle()} disabled={!included.length || starting} className="btn btn-primary !min-h-12">
              {starting ? 'Starting…' : 'Start haggling'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The shop's own product listing, by sku — falls back to a minimal item
 * synthesized from the cart line itself (never crashes) for the brief
 * window where a real shop's products are still loading
 * (`useRealShopProducts` resolves async) or any other sku it can't find.
 */
function itemOf(line: CartLine, shop: { products: InventoryItem[] }): InventoryItem {
  return (
    shop.products.find((p) => p.sku === line.sku) ?? {
      sku: line.sku,
      itemId: 'tomato',
      title: line.title,
      emoji: line.emoji,
      unit: line.unit,
      listCents: line.listCents,
      floorCents: line.listCents,
      stock: line.stock,
      market: { median: line.listCents, p25: Math.round(line.listCents * 0.9), p75: Math.round(line.listCents * 1.1) },
    }
  );
}

function StepBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label === '+' ? 'Add one' : 'Remove one'}
      className="grid h-11 w-11 place-items-center rounded-xl bg-paper text-lg font-semibold text-ink shadow-sm transition active:scale-95"
    >
      {label}
    </button>
  );
}
