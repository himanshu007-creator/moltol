import { useEffect, useState } from 'react';
import { useOrders, fromBackendOrder, TRACKER_STEPS, type PaymentStatus } from '@/stores/orders';
import { useSession } from '@/stores/session';
import { listOrders } from '@/lib/backend';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

const PAYMENT: Record<PaymentStatus, { label: string; cls: string }> = {
  order_created: { label: 'Placed', cls: 'pill' },
  approved: { label: 'Approved', cls: 'pill pill-marigold' },
  captured: { label: 'Paid', cls: 'pill pill-teal' },
  failed: { label: 'Failed', cls: 'pill pill-chili' },
  refunded: { label: 'Refunded', cls: 'pill pill-chili' },
};

/** Orders as tickets: total, payment state, the three-step tracker and the collect code. */
export default function Orders() {
  const orders = useOrders();
  const token = useSession((s) => s.token);
  const [go, setGo] = useState(false);

  useEffect(() => {
    const t = setInterval(() => orders.tick(), 2000);
    return () => clearInterval(t);
  }, [orders]);

  useEffect(() => {
    const t = setTimeout(() => setGo(true), 150);
    return () => clearTimeout(t);
  }, []);

  // Fails silently if the backend is unreachable, same fail-soft pattern used throughout.
  useEffect(() => {
    if (!token) return;
    listOrders(token)
      .then((real) => real.forEach((o) => useOrders.getState().upsert(fromBackendOrder(o))))
      .catch(() => {});
  }, [token]);

  if (!orders.orders.length) {
    return (
      <div className="surface grid justify-items-center gap-4 p-10 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-paper-3 text-4xl" aria-hidden="true">🧺</span>
        <div>
          <p className="t-h2">No orders yet</p>
          <p className="mt-1 text-ink-muted">Haggle a basket and it will show up here with its receipt and tracker.</p>
        </div>
        <a href="/app/buy" className="btn btn-primary">Haggle your first basket</a>
      </div>
    );
  }

  return (
    <ul className="grid gap-4" aria-label="Orders">
      {orders.orders.map((o) => {
        const pay = PAYMENT[o.paymentStatus ?? 'order_created'];
        const ready = go && o.trackerIndex === TRACKER_STEPS.length - 1;
        return (
          <li key={o.id} className="surface ticket-edge grid gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-paper-3 text-2xl" aria-hidden="true">{o.shopEmoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{o.shopName}</p>
                <p className="text-xs text-ink-muted">
                  {o.lines.length} items · {new Date(o.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · proof {o.proofVerified ? 'verified' : 'pending'}
                </p>
              </div>
              <div className="grid justify-items-end gap-1">
                <span className="t-num text-lg font-semibold text-ink">{formatMoney(o.totalCents)}</span>
                <span className={cn(pay.cls)}>{pay.label}</span>
              </div>
            </div>

            <ol className="grid grid-cols-3 gap-2" aria-label="Order progress">
              {TRACKER_STEPS.map((s, i) => {
                const done = i <= o.trackerIndex;
                return (
                  <li key={s} className="grid gap-1.5">
                    <span className={cn('h-1.5 rounded-full', done ? 'bg-teal' : 'bg-paper-3')} />
                    <span className={cn('text-xs font-semibold', done ? 'text-ink' : 'text-ink-faint')}>{s}</span>
                  </li>
                );
              })}
            </ol>

            {ready && (
              <div className="surface-soft flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-ink">
                  <b className="font-semibold">Ready to collect.</b> Show <span className="t-num font-semibold">{o.id}</span> at the stall.
                </p>
                <a href={`/app/receipt?order=${o.id}`} className="btn btn-teal !min-h-10 !text-sm">Show receipt</a>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
