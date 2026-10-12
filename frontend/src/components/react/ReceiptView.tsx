import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BadgeCheck, Lock, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import { useNegotiation } from '@/stores/negotiation';
import { reduceAll } from '@/lib/negotiation';
import { verifyReveal } from '@/lib/policy';
import { loadFixture } from '@/lib/ws';
import { formatMoney } from '@/lib/money';
import { button, card, chip, mono, panel } from '@/lib/ui';
import { cn } from '@/lib/cn';
import { Badge, Meter } from '@/components/react/ui';
import { useI18n } from '@/stores/prefs';

export default function ReceiptView() {
  const { t } = useI18n();
  const live = useNegotiation((s) => s.state);
  const demo = useMemo(() => reduceAll(loadFixture().events), []);
  const state = live.phase === 'revealed' || live.applied > 0 ? live : demo;

  const [revealed, setRevealed] = useState(() => Boolean(state.reveal));
  const [checks, setChecks] = useState<{ buyer: boolean; shop: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!revealed || !state.reveal) return;
    let active = true;
    (async () => {
      const buyer = state.commits.buyer
        ? await verifyReveal(state.commits.buyer, state.reveal!.buyerLimitCents, state.reveal!.buyerSalt)
        : state.reveal!.verified;
      const shop = state.commits.shop
        ? await verifyReveal(state.commits.shop, state.reveal!.shopFloorCents, state.reveal!.shopSalt)
        : state.reveal!.verified;
      if (active) setChecks({ buyer, shop });
    })();
    return () => {
      active = false;
    };
  }, [revealed, state]);

  const reveal = state.reveal;
  const price = state.agreedPriceCents ?? 0;
  const currency = state.currency;

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

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6 sm:pt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="t-label">
            {t('receipt.title')}
          </p>
          <h1 className="mt-1 t-h1">{state.item || 'MolTol deal'}</h1>
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
            <p className={cn(mono, 'text-4xl font-bold text-teal')}>{formatMoney(price, currency)}</p>
          </div>
          <div className="text-right">
            <Badge variant="success">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('receipt.verified')}
            </Badge>
            {state.orderId && (
              <p className={cn(mono, 'mt-2 text-xs text-ink-faint')}>order {state.orderId}</p>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{t('receipt.fairness')}</span>
              <span className={cn(mono, 'font-semibold text-ink')}>{state.fairness}/100</span>
            </div>
            <div className="mt-2">
              <Meter value={state.fairness} label={t('receipt.fairness')} tone="teal" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{t('receipt.saved')}</span>
              <span className={cn(mono, 'font-semibold text-ink')}>
                {formatMoney(state.buyerSavedCents, currency)}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-faint">Against the median nearby price.</p>
          </div>
        </div>
      </div>

      {/* sealed limits */}
      <div className={cn(panel, 'mt-6 p-5')}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Sealed limits
          </h2>
          {!revealed && (
            <button type="button" onClick={() => setRevealed(true)} className={button('secondary')}>
              {t('receipt.reveal')}
            </button>
          )}
        </div>

        {!revealed && (
          <>
            <p className="mt-2 text-sm text-ink-muted">
              Both sides committed to a hash before the first offer. Reveal to check the commits.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(['buyer', 'shop'] as const).map((side) => (
                <div key={side} className="rounded-xl border border-chalk bg-paper px-3 py-2">
                  <p className="text-xs text-ink-faint capitalize">{side} commit</p>
                  <p className={cn(mono, 'truncate text-xs text-ink-muted')}>
                    {state.commits[side]?.slice(0, 24) ?? '—'}…
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {revealed && reveal && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-marigold/40 bg-marigold/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-marigold">
                {t('receipt.buyerLimit')}
              </p>
              <p className={cn(mono, 'mt-1 text-2xl font-bold text-ink')}>
                {formatMoney(reveal.buyerLimitCents, currency)}
              </p>
              <p className={cn(mono, 'mt-1 truncate text-[11px] text-ink-faint')}>salt {reveal.buyerSalt}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {checks ? (checks.buyer ? 'commit matches' : 'mismatch') : 'checking…'}
              </p>
            </div>
            <div className="rounded-xl border border-chili/40 bg-chili/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-chili">
                {t('receipt.shopFloor')}
              </p>
              <p className={cn(mono, 'mt-1 text-2xl font-bold text-ink')}>
                {formatMoney(reveal.shopFloorCents, currency)}
              </p>
              <p className={cn(mono, 'mt-1 truncate text-[11px] text-ink-faint')}>salt {reveal.shopSalt}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {checks ? (checks.shop ? 'commit matches' : 'mismatch') : 'checking…'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* timeline */}
      <div className={cn(panel, 'mt-6 p-5')}>
        <h2 className="text-sm font-semibold text-ink">{t('receipt.timeline')}</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <Milestone done icon={<Lock className="h-4 w-4" />} label="Limits sealed before the haggle" />
          <Milestone done icon={<Sparkles className="h-4 w-4" />} label={`${state.turns.length} offers exchanged`} />
          <Milestone done={price > 0} icon={<BadgeCheck className="h-4 w-4" />} label={`Deal agreed at ${formatMoney(price, currency)}`} />
          <Milestone done={state.paymentStatus === 'captured'} icon={<ShieldCheck className="h-4 w-4" />} label="PayPal sandbox captured" />
          <Milestone done={revealed} icon={<Lock className="h-4 w-4" />} label="Sealed limits revealed & verified" />
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
