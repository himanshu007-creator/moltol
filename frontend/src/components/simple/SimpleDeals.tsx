import { Fragment, useEffect, useRef, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { getDealsTicket, dealsStreamUrl, type DealFeedEvent } from '@/lib/backend';
import { type Locale, s, nativeRupaye } from '@/lib/simple/strings';
import { useOrders, type Order, type PaymentStatus } from '@/stores/orders';
import { useVenue } from '@/stores/venue';

/**
 * The seller's real live deal feed (`GET /v1/shops/me/deals/stream`, see ADR
 * 0007) — a shop-scoped ticket since `EventSource` can't send an auth header.
 * A ticket is good for 120s, so a dropped connection fetches a fresh one
 * before reopening rather than relying on native retry against a stale URL.
 */
function useRealDealFeed(): DealFeedEvent[] {
  const token = useSession((s) => s.token);
  const [events, setEvents] = useState<DealFeedEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);
  useEffect(() => {
    setEvents([]);
    if (!token) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      void getDealsTicket(token)
        .then(({ ticket }) => {
          if (cancelled) return;
          const url = dealsStreamUrl(ticket);
          if (!url) return;
          const source = new EventSource(url);
          sourceRef.current = source;
          source.onmessage = (ev) => {
            try {
              const frame = JSON.parse(ev.data as string) as DealFeedEvent;
              setEvents((prev) => [frame, ...prev].slice(0, 20));
            } catch {
              /* ignore malformed frame */
            }
          };
          source.onerror = () => {
            source.close();
            if (!cancelled) retryTimer = setTimeout(connect, 2000);
          };
        })
        .catch(() => {
          // No real shop yet, or backend unreachable — the feed just stays empty.
        });
    };
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      sourceRef.current?.close();
    };
  }, [token]);
  return events;
}

export default function SimpleDeals() {
  const { todayEarningsCents, language } = useSimple();
  const dict = s(language);
  const shopId = useSession((st) => st.shopId);
  const paid = useOrders((o) => o.orders).filter((o) => o.shopId === shopId);
  const open = useVenue((st) => (shopId ? st.stalls[shopId]?.open !== false : true));
  const realDeals = useRealDealFeed();

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.homeDeals}</h1>
      <p className="mt-1 text-sm text-ink-faint">{dict.u.earningsToday}: <b>{nativeRupaye(todayEarningsCents, language)}</b></p>

      {/* real, live offers on a real shop's basket lines */}
      {realDeals.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-ink">Live on your shop</h2>
          <div className="mt-2 grid gap-2">
            {realDeals.map((d, i) => (
              <div key={`${d.ts}-${i}`} className="flex items-center gap-3 surface p-4">
                <span className="text-2xl" aria-hidden="true">{d.t === 'deal.incoming' ? '🛎️' : d.won ? '✅' : '🚪'}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {d.t === 'deal.incoming'
                      ? `New basket · ${d.lines.length} item${d.lines.length === 1 ? '' : 's'}`
                      : `${d.name} — ${d.won ? 'closed' : "didn't close"}`}
                  </p>
                  <p className="text-xs text-ink-faint">{timeOf(new Date(d.ts).getTime())}</p>
                </div>
                {d.t === 'deal.closed' && d.won && d.unitCents != null && (
                  <span className="text-lg font-bold text-teal">{nativeRupaye(d.unitCents, language)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* buyer-paid orders = receipts from the shared orders ledger */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-ink">{dict.u.sellerOrders}</h2>
        <p className="text-xs text-ink-faint">{dict.u.sellerOrdersHint}</p>
        <div className="mt-2 grid gap-2">
          {paid.map((o) => (
            <SellerReceipt key={o.id} order={o} language={language} paidLabel={dict.u.sellerOrderPaid} />
          ))}
          {!paid.length && (
            <p className="surface p-5 text-center text-sm text-ink-faint">
              {open ? dict.u.sellerNoOrders : dict.u.stallClosedHint}
            </p>
          )}
        </div>
      </div>

    </div>
  );
}

function SellerReceipt({ order, language, paidLabel }: { order: Order; language: Locale; paidLabel: string }) {
  const [show, setShow] = useState(false);
  const st: PaymentStatus = order.paymentStatus ?? 'order_created';
  return (
    <div className="surface p-4">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-expanded={show}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="text-3xl">{order.shopEmoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{order.id}</span>
          <span className="block text-xs text-ink-faint">{timeOf(order.ts)} · {order.lines.length} items</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st === 'captured' ? 'bg-teal/12 text-teal' : st === 'approved' ? 'bg-marigold/20 text-warn' : 'bg-paper-3 text-ink-muted'}`}>
            {st === 'captured' ? `💵 ${paidLabel}` : st === 'approved' ? '⏳' : '🔹'}
          </span>
          <span className="text-base font-bold text-teal">+{nativeRupaye(order.totalCents, language)}</span>
        </span>
      </button>
      {show && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-chalk pt-3 text-sm">
          {order.lines.map((l) => (
            <Fragment key={l.sku}>
              <dt className="truncate text-ink-faint">{l.emoji} {l.title} × {l.qty}</dt>
              <dd className="text-right tabular-nums text-ink">{nativeRupaye(l.qty ? l.unitCents * l.qty : l.unitCents, language)}</dd>
            </Fragment>
          ))}
          <dt className="text-ink-faint">Total</dt>
          <dd className="text-right tabular-nums font-bold text-teal">{nativeRupaye(order.totalCents, language)}</dd>
          {st === 'captured' && order.proofVerified && (
            <dt className="col-span-2 mt-1 text-xs text-teal">✅ proof verified</dt>
          )}
        </dl>
      )}
    </div>
  );
}

function timeOf(ts: number) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}