import { useState, type ReactNode } from 'react';
import { BadgeCheck, Lock, Share2, ShieldCheck } from 'lucide-react';
import { useOrders, TRACKER_STEPS, type Order } from '@/stores/orders';
import { formatMoney } from '@/lib/money';
import { button, card, chip, mono, panel } from '@/lib/ui';
import { cn } from '@/lib/cn';
import { Badge, Meter } from '@/components/react/ui';
import { useI18n } from '@/stores/prefs';
import HashVerify from '@/components/motion/HashVerify';

function orderIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('order');
}

export default function ReceiptView() {
  const orders = useOrders((s) => s.orders);
  const [orderId] = useState(orderIdFromUrl);
  const order = orderId ? orders.find((o) => o.id === orderId) : undefined;

  if (!order) {
    return (
      <div className="mx-auto max-w-md px-4 pt-14 text-center sm:px-6">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-paper-3 text-3xl mx-auto" aria-hidden="true">🧾</span>
        <h1 className="mt-4 t-h2">No order selected</h1>
        <p className="mt-2 text-ink-muted">
          Receipts are tied to a real order — open one from your orders list to see its proof here.
        </p>
        <a href="/app/orders" className="btn btn-primary mt-6">View your orders</a>
      </div>
    );
  }

  return <Receipt order={order} />;
}

function Receipt({ order }: { order: Order }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'MolTol — Proof of Fair Deal', url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const when = new Date(order.ts);
  const captured = order.paymentStatus === 'captured';
  const ready = order.trackerIndex >= TRACKER_STEPS.length - 1;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6 sm:pt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="t-label">{t('receipt.title')}</p>
          <h1 className="mt-1 t-h1">
            {order.shopEmoji} {order.shopName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <button type="button" onClick={share} className={cn(button('secondary'), 'shrink-0')}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {copied ? 'Link copied' : t('receipt.share')}
        </button>
      </div>

      {/* the receipt */}
      <div className={cn(card, 'relative mt-6 overflow-hidden p-6')}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-marigold via-teal to-chili" />
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-ink-muted">Settled price</p>
            <p className={cn(mono, 'text-4xl font-bold text-teal')}>{formatMoney(order.totalCents)}</p>
          </div>
          <div className="text-right">
            <Badge variant={order.proofVerified ? 'success' : 'neutral'}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {order.proofVerified ? t('receipt.verified') : 'Pending'}
            </Badge>
            <p className={cn(mono, 'mt-2 text-xs text-ink-faint')}>order {order.id}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{t('receipt.fairness')}</span>
              <span className={cn(mono, 'font-semibold text-ink')}>{order.fairness}/100</span>
            </div>
            <div className="mt-2">
              <Meter value={order.fairness} label={t('receipt.fairness')} tone="teal" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{t('receipt.saved')}</span>
              <span className={cn(mono, 'font-semibold text-ink')}>{formatMoney(order.savingsCents)}</span>
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Against the {formatMoney(order.listCents ?? order.marketCents)} sticker price.
            </p>
          </div>
        </div>
      </div>

      {/* items */}
      <div className={cn(panel, 'mt-6 p-5')}>
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        <ul className="mt-3 grid gap-2">
          {order.lines.map((l) => (
            <li key={l.sku} className="flex items-center gap-3 text-sm">
              <span className="text-lg" aria-hidden="true">{l.emoji}</span>
              <span className="flex-1 truncate text-ink">
                {l.title} × {l.qty} {l.unit}
              </span>
              <span className={cn(mono, 'text-ink')}>{formatMoney(l.unitCents * l.qty)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* proof — same settlement-hash attestation the checkout screen shows,
          recomputed here so a revisited receipt can be verified independently. */}
      <div className={cn(panel, 'mt-6 p-5')}>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Proof of fair deal
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Each agent locked its limit before haggling. The final price sat between the shop's lowest price and the
          market median.
        </p>
        <div className="mt-4 grid gap-2 border-t border-chalk pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Settlement hash</p>
          <HashVerify input={`${order.id}|${order.totalCents}|${order.marketCents}`} />
        </div>
      </div>

      {/* timeline */}
      <div className={cn(panel, 'mt-6 p-5')}>
        <h2 className="text-sm font-semibold text-ink">{t('receipt.timeline')}</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <Milestone done icon={<BadgeCheck className="h-4 w-4" />} label={`Deal agreed at ${formatMoney(order.totalCents)}`} />
          <Milestone done={captured} icon={<ShieldCheck className="h-4 w-4" />} label="PayPal sandbox captured" />
          <Milestone done={order.proofVerified} icon={<Lock className="h-4 w-4" />} label="Fairness proof verified" />
          <Milestone done={ready} icon={<BadgeCheck className="h-4 w-4" />} label="Ready to collect" />
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <span className={chip}>
            <span className="font-mono">sha256</span> commitments
          </span>
          <span className={chip}>Sandbox settlement</span>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-ink-faint">
        MolTol never sees your card. Payment runs through the PayPal sandbox only.
      </p>
    </div>
  );
}

function Milestone({ done, icon, label }: { done?: boolean; icon: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full border',
          done ? 'border-teal/40 bg-teal/10 text-teal' : 'border-chalk bg-paper text-ink-faint',
        )}
      >
        {icon}
      </span>
      <span className={done ? 'text-ink' : 'text-ink-faint'}>{label}</span>
    </li>
  );
}
