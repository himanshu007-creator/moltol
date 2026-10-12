import { Fragment, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { type Locale, s, nativeRupaye, nativeNum } from '@/lib/simple/strings';
import { useOrders, type Order, type PaymentStatus } from '@/stores/orders';
import { useVenue, DEMO_SLOT_ID } from '@/stores/venue';

export default function SimpleDeals() {
  const { dealsLog, todayEarningsCents, language } = useSimple();
  const dict = s(language);
  const paid = useOrders((o) => o.orders).filter((o) => o.shopId === DEMO_SLOT_ID);
  const open = useVenue((st) => st.stalls[DEMO_SLOT_ID]?.open !== false);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.homeDeals}</h1>
      <p className="mt-1 text-sm text-ink-faint">{dict.u.earningsToday}: <b>{nativeRupaye(todayEarningsCents, language)}</b></p>

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

      {/* live haggle deals */}
      <div className="mt-6 grid gap-2">
        {dealsLog.map((d) => (
          <div key={d.ts} className="flex items-center gap-3 surface p-4">
            <span className="text-3xl">{d.emoji}</span>
            <div className="flex-1">
              <p className="text-base font-semibold text-ink">{d.item}</p>
              <p className="text-xs text-ink-faint">{timeOf(d.ts)}</p>
            </div>
            <span className="text-xl font-bold text-teal">+{nativeRupaye(d.cents, language)}</span>
          </div>
        ))}
        {!dealsLog.length && (
          <p className="surface p-5 text-center text-ink-faint">
            {dict.u.haggleWaiting} · <a href="/app/seller/simple/haggle" className="text-chili underline">→ {dict.u.homeDeals}</a>
          </p>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-ink-faint">{nativeNum(dealsLog.length, language)} {dict.u.homeDeals}</p>
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