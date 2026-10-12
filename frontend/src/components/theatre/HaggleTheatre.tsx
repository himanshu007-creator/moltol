import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ArrowRight, RefreshCw, RotateCcw, Store, Zap } from 'lucide-react';
import { useNegotiation } from '@/stores/negotiation';
import { currentRound, lastOffer, selectSeries, type Phase } from '@/lib/negotiation';
import { DEMO_PRODUCT_ID, getProduct, getShop } from '@/lib/catalog';
import { defaultBuyerMax } from '@/lib/engine';
import { PERSONAS } from '@/lib/policy';
import { formatMoney } from '@/lib/money';
import { card, chip, mono, panel } from '@/lib/ui';
import { cn } from '@/lib/cn';
import { Badge, Price } from '@/components/react/ui';
import { Stall } from './Stall';
import { OfferTable } from './OfferTable';
import { HaggleChart } from './HaggleChart';
import { Transcript } from './Transcript';
import { TakeoverBar } from './TakeoverBar';
import { useI18n } from '@/stores/prefs';

const HandshakeScene = lazy(() => import('./Handshake'));

const phaseCopy: Record<Phase, { label: string; variant: 'neutral' | 'buyer' | 'shop' | 'success' | 'info' }> = {
  connecting: { label: 'connecting…', variant: 'neutral' },
  negotiating: { label: 'haggling', variant: 'buyer' },
  agreed: { label: 'deal agreed', variant: 'success' },
  paying: { label: 'settling', variant: 'info' },
  paid: { label: 'paid', variant: 'success' },
  revealed: { label: 'verified', variant: 'success' },
  no_deal: { label: 'no deal', variant: 'shop' },
  failed: { label: 'failed', variant: 'shop' },
};

function StatusTimeline({ phase }: { phase: Phase }) {
  const steps = ['sealed', 'haggle', 'agree', 'pay', 'prove'];
  const reached: Record<string, boolean> = {
    sealed: phase !== 'connecting',
    haggle: ['negotiating', 'agreed', 'paying', 'paid', 'revealed', 'no_deal'].includes(phase),
    agree: ['agreed', 'paying', 'paid', 'revealed'].includes(phase),
    pay: ['paid', 'revealed'].includes(phase),
    prove: phase === 'revealed',
  };
  return (
    <ol className="flex items-center gap-1 text-[11px] text-ink-faint" aria-label="Negotiation progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 font-medium capitalize',
              reached[s] ? 'border-teal/40 bg-teal/10 text-teal' : 'border-chalk bg-paper',
            )}
          >
            {s}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true">·</span>}
        </li>
      ))}
    </ol>
  );
}

export default function HaggleTheatre() {
  const state = useNegotiation((s) => s.state);
  const status = useNegotiation((s) => s.status);
  const source = useNegotiation((s) => s.source);
  const takeover = useNegotiation((s) => s.takeover);
  const speed = useNegotiation((s) => s.speed);
  const startEngine = useNegotiation((s) => s.startEngine);
  const startReplay = useNegotiation((s) => s.startReplay);
  const restart = useNegotiation((s) => s.restart);
  const setSpeed = useNegotiation((s) => s.setSpeed);
  const takeOver = useNegotiation((s) => s.takeOver);
  const humanOffer = useNegotiation((s) => s.humanOffer);
  const runOpts = useNegotiation((s) => s.runOpts);
  const { t } = useI18n();

  const [showHandshake, setShowHandshake] = useState(false);
  const started = useRef(false);
  const [params] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams(),
  );

  const negotiationId = params.get('id') ?? 'demo-bottle-01';
  const productId = params.get('product') ?? DEMO_PRODUCT_ID;
  const mode = params.get('mode');
  const maxParam = params.get('max');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const max = maxParam ? Number(maxParam) : defaultBuyerMax(productId);
    if (mode === 'replay') {
      startReplay(productId);
      return;
    }
    void startEngine({ negotiationId, productId, buyerMaxCents: max });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase === 'agreed') setShowHandshake(true);
  }, [state.phase]);

  const product = getProduct(runOpts?.productId ?? productId);
  const shop = product ? getShop(product.shopId) : undefined;

  const series = useMemo(() => selectSeries(state), [state]);
  const buyerLast = lastOffer(state, 'buyer');
  const shopLast = lastOffer(state, 'shop');
  const round = currentRound(state);
  const phase = state.phase;
  const copy = phaseCopy[phase];
  const mandate = runOpts?.buyerMaxCents ?? defaultBuyerMax(productId);

  const suggested = buyerLast ?? Math.round(mandate * 0.85);
  const isLive = source === 'engine' || source === 'socket';

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:pt-10">
        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="t-label">
              {t('theatre.title')}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">
              {state.item || 'Reading the room…'}
            </h1>
            {shop && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-muted">
                <Store className="h-4 w-4" aria-hidden="true" />
                {shop.displayName} · {shop.location}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isLive ? 'buyer' : 'info'}>
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              {isLive ? t('common.live') : t('common.replay')}
            </Badge>
            <Badge variant={copy.variant}>{copy.label}</Badge>
            <div className="flex overflow-hidden rounded-full border border-chalk">
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSpeed(s);
                    restart();
                  }}
                  className={cn(
                    'px-2.5 py-1 text-xs font-semibold',
                    speed === s ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-muted hover:text-ink',
                  )}
                  aria-pressed={speed === s}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={restart}
              className="grid h-9 w-9 place-items-center rounded-full border border-chalk bg-paper-2 text-ink-muted hover:text-ink"
              aria-label="Restart negotiation"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <StatusTimeline phase={phase} />
        </div>

        {/* the theatre */}
        <section className="mt-5 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_15rem] lg:items-start">
          <div className="lg:col-start-1 lg:row-start-1">
            <Stall
              side="buyer"
              name={t('theatre.buyer')}
              persona={`${PERSONAS.analyst.label} — ${PERSONAS.analyst.voice}`}
              lastCents={buyerLast}
              currency={state.currency}
              thinking={status === 'playing' || status === 'replay' || status === 'open'}
              human={takeover}
            />
          </div>

          <div className="lg:col-start-3 lg:row-start-1">
            <Stall
              side="shop"
              name={shop?.ownerName ?? t('theatre.shop')}
              persona={shop ? `${PERSONAS[shop.persona].label} — ${PERSONAS[shop.persona].voice}` : t('theatre.shop')}
              lastCents={shopLast}
              currency={state.currency}
              thinking={status === 'playing' || status === 'replay' || status === 'open'}
            />
          </div>

          <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
            <div className={cn(card, 'relative overflow-hidden p-4')}>
              <OfferTable
                buyerCents={buyerLast}
                shopCents={shopLast}
                market={state.market}
                currency={state.currency}
                round={Math.max(1, Math.ceil(round / 2))}
                roundsMax={state.roundsMax}
              />

              {/* settlement strip */}
              {(phase === 'paying' || phase === 'paid' || phase === 'revealed') && (
                <div className="mt-3 rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-sm text-teal">
                  {phase === 'paying' && t('theatre.settling')}
                  {phase === 'paid' && (
                    <span>
                      Paid · order <span className={cn(mono, 'text-teal')}>{state.orderId}</span>
                    </span>
                  )}
                  {phase === 'revealed' && (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span>{t('theatre.dealClosed')} · verified</span>
                      <a
                        href={`/app/receipt?id=${encodeURIComponent(state.negotiationId)}`}
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                      >
                        {t('receipt.title')}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </span>
                  )}
                </div>
              )}

              {phase === 'no_deal' && (
                <div className="mt-3 rounded-xl border border-chili/40 bg-chili/10 px-3 py-2 text-sm text-chili">
                  No deal — the numbers never met. Walking away was the honest move.
                  <button
                    type="button"
                    onClick={restart}
                    className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
                  </button>
                </div>
              )}

              {phase === 'negotiating' && (
                <div className="mt-3 flex items-center justify-between text-xs text-ink-faint">
                  <span>
                    {t('theatre.table')} · round {Math.min(round, state.roundsMax)} / {state.roundsMax}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    sealed ceilings <span className="font-mono">🔒</span>
                  </span>
                </div>
              )}
            </div>

            <div className={cn(card, 'p-4')}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Offer trajectory</h2>
                <span className={cn(chip, 'gap-1')}>
                  <span className="h-2 w-2 rounded-full bg-indigo" aria-hidden="true" />
                  {t('theatre.market')}{' '}
                  {state.market && (
                    <span className={cn(mono, 'text-ink-muted')}>
                      {formatMoney(state.market.p25Cents, state.currency)}–
                      {formatMoney(state.market.p75Cents, state.currency)}
                    </span>
                  )}
                </span>
              </div>
              <HaggleChart
                series={series}
                market={state.market}
                currency={state.currency}
                reveal={state.reveal}
                agreedPriceCents={state.agreedPriceCents}
                roundsMax={state.roundsMax}
              />
            </div>

            <div className={cn(panel, 'p-4')}>
              <h2 className="mb-3 text-sm font-semibold text-ink">{t('theatre.transcript')}</h2>
              <Transcript turns={state.turns} currency={state.currency} />
            </div>

            <TakeoverBar
              active={phase === 'negotiating'}
              takeover={takeover}
              currency={state.currency}
              mandateCents={mandate}
              suggestedCents={suggested}
              onToggle={takeOver}
              onSend={(cents) => {
                humanOffer(cents);
                takeOver(false);
              }}
            />
          </div>
        </section>

        {/* the one loud moment */}
        {showHandshake && phase === 'agreed' && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deal closed">
            <div className="relative h-[min(70vh,32rem)] w-[min(90vw,44rem)] overflow-hidden rounded-[var(--radius-card)] border border-chalk-strong bg-ink">
              <Suspense
                fallback={<div className="grid h-full place-items-center text-teal">Deal closed</div>}
              >
                <HandshakeScene
                  label={state.agreedPriceCents != null ? formatMoney(state.agreedPriceCents, state.currency) : 'Deal closed'}
                  onDone={() => setShowHandshake(false)}
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* live price footnote for the impatient */}
        <p className="mt-6 text-center text-xs text-ink-faint">
          <Price cents={state.agreedPriceCents ?? shopLast} currency={state.currency} className="font-mono" />{' '}
          {state.agreedPriceCents != null ? 'settled' : 'on the table'}
        </p>
      </div>
    </MotionConfig>
  );
}
