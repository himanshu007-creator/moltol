import TickPrice from '@/components/motion/TickPrice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useBazaar, selectBazaar, type LaneSummary, type BazaarState } from '@/stores/bazaar';
import { selectSeries, type TurnEntry } from '@/lib/negotiation';
import { HaggleChart } from '@/components/theatre/HaggleChart';
import { OverviewTugOfWar } from '@/components/theatre/OverviewTugOfWar';
import { formatMoney } from '@/lib/money';
import { whenHydrated } from '@/lib/hydrated';
import { cn } from '@/lib/cn';

/** above this many lanes, the left list loops instead of growing the page forever */
const LOOP_THRESHOLD = 5;

export default function BazaarTheatre() {
  const bz = useBazaar();
  const sum = useMemo(() => selectBazaar(bz), [bz]);
  const [chat, setChat] = useState<string | null>(null);
  const [chartOpen, setChartOpen] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  // A full-reload nav (location.href from /cart) kills the store clock — restart it,
  // but only once the store has actually hydrated from IndexedDB: calling resume()
  // too early sees the pre-hydration default state (stage 'idle'), its guard
  // no-ops, and nothing ever retries.
  useEffect(() => whenHydrated(useBazaar, () => useBazaar.getState().resume()), []);

  if (bz.stage === 'idle') {
    return (
      <div className="flex flex-col items-center gap-3 surface p-8 text-center">
        <span className="text-5xl">{bz.error ? '⚠️' : '🤝'}</span>
        <p className="text-lg font-semibold text-ink">{bz.error ?? 'No live haggle yet'}</p>
        <a href="/app/cart" className="rounded-full bg-chili px-5 py-2.5 text-sm font-bold text-white">
          {bz.error ? 'Back to your basket →' : 'Pick items in your basket →'}
        </a>
      </div>
    );
  }

  const agreed = sum.lanes.filter((l) => l.done && !l.noDeal);
  const live = sum.lanes.filter((l) => !l.done);
  const hasChartData = sum.lanes.some((l) => l.turns.length > 0);
  const anyControlled = sum.lanes.some((l) => l.controlled);
  const looping = sum.lanes.length > LOOP_THRESHOLD;
  const laneProps = { bz, chat, setChat, chartOpen, setChartOpen };

  return (
    <div className="grid gap-6 pb-48 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
      <div>
        <div className="bg-mural flex items-center justify-between rounded-2xl px-4 py-3">
          <h1 className="text-xl font-display font-extrabold text-ink">Live bazaar</h1>
          <span className="rounded-full bg-chili/10 px-3 py-1 text-xs font-bold text-chili">
            {bz.style} · {sum.totalDone} lanes
          </span>
        </div>

        {looping ? (
          <div
            className="relative mt-4 max-h-[34rem] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_6%,black_94%,transparent)]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <div
              className="loop-track grid gap-3 motion-reduce:animate-none"
              style={{
                animationDuration: `${sum.lanes.length * 3.5}s`,
                animationPlayState: paused || anyControlled ? 'paused' : 'running',
              }}
            >
              {sum.lanes.map((l) => (
                <LaneCard key={l.sku} l={l} {...laneProps} />
              ))}
              {/* a second, read-only copy makes the loop seamless; hidden from assistive tech and the tab order */}
              <div aria-hidden="true" className="contents">
                {sum.lanes.map((l) => (
                  <LaneCardGhost key={`echo-${l.sku}`} l={l} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            <AnimatePresence initial={false}>
              {sum.lanes.map((l) => (
                <LaneCard key={l.sku} l={l} {...laneProps} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {sum.noDealCount > 0 && !live.length && (
          <div className="mt-4 surface p-4 text-sm text-ink-muted">
            ⚖️ {sum.noDealCount} item{gsum(sum.noDealCount)} hit the no-deal red line. The agent never overpays — that’s the proof.
          </div>
        )}
      </div>

      {/* every item's buyer/shop offers, converging live — same shape for 1 item or 20 */}
      {hasChartData && (
        <aside className="surface hidden flex-col gap-2 p-5 lg:sticky lg:top-24 lg:flex lg:h-[calc(100vh-15rem)]">
          <p className="t-label shrink-0">How it's going</p>
          <div className="min-h-0 flex-1">
            <OverviewTugOfWar sum={sum} />
          </div>
        </aside>
      )}

      {/* sticky summary */}
      {agreed.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 px-4 sm:bottom-24">
          <div className="mx-auto flex max-w-md flex-col gap-2 rounded-3xl bg-ink p-3 text-paper shadow-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-paper/70">Agreed {agreed.length}/{sum.totalDone}</span>
              <span className="text-lg font-bold tabular-nums">{formatMoney(sum.totalAgreedCents)}</span>
              <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-bold text-white">
                save {formatMoney(sum.totalSavedCents)}
              </span>
            </div>
            <a
              href="/app/checkout"
              className={`rounded-2xl py-3 text-center text-sm font-bold active:scale-[0.98] ${live.length ? 'bg-paper/20 text-paper/70' : 'bg-marigold text-[#23180a]'}`}
              aria-disabled={!!live.length}
            >
              {live.length ? `Settle when the rest finish (${live.length} live)` : '🧾 Proof & pay →'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

interface LaneCardProps {
  l: LaneSummary;
  bz: BazaarState;
  chat: string | null;
  setChat: (v: string | null) => void;
  chartOpen: string | null;
  setChartOpen: (v: string | null) => void;
}

function LaneCard({ l, bz, chat, setChat, chartOpen, setChartOpen }: LaneCardProps) {
  const last = l.priceCents != null ? l.priceCents : l.listCents;
  const agree = l.agreedCents != null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-3xl border p-4 ${agree ? 'border-teal/50 bg-teal/10' : l.noDeal ? 'border-chalk bg-paper-2 opacity-70' : l.controlled ? 'border-marigold bg-marigold/10' : 'border-chalk bg-paper-2'}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl">{l.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{l.title.en} × {l.qty}</p>
          <p className="text-xs text-ink-faint">
            list {formatMoney(l.listCents)}
            {l.marketCents != null && <span className="text-ink-muted"> · market {formatMoney(l.marketCents)}</span>}
          </p>
        </div>
        <Chip ok={agree} noDeal={l.noDeal} running={l.running} controlled={l.controlled} />
      </div>

      {l.turns.length > 0 && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setChat(chat === l.sku ? null : l.sku)}
            className="flex-1 rounded-2xl bg-paper-3/60 px-3 py-2 text-left text-sm text-ink-muted"
          >
            💬 {l.turns[l.turns.length - 1]!.message}
            {l.fairness > 0 && <span className="float-right text-teal">fair {l.fairness}%</span>}
          </button>
          <button
            type="button"
            onClick={() => setChartOpen(chartOpen === l.sku ? null : l.sku)}
            aria-pressed={chartOpen === l.sku}
            aria-label="Show the offer chart"
            className="grid aspect-square min-h-11 place-items-center rounded-2xl bg-paper-3/60 text-lg transition active:scale-95"
          >
            📈
          </button>
        </div>
      )}

      <AnimatePresence>
        {chartOpen === l.sku && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 overflow-hidden rounded-2xl"
          >
            <HaggleChart
              series={selectSeries(l.state)}
              market={l.state.market}
              currency={l.state.currency}
              reveal={l.state.reveal}
              agreedPriceCents={l.state.agreedPriceCents}
              roundsMax={l.state.roundsMax}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chat === l.sku && <ChatTranscript turns={l.turns} />}
      </AnimatePresence>

      {!l.done && !l.controlled && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
            <motion.div
              className="h-full bg-marigold"
              initial={{ width: '0%' }}
              animate={{ width: l.running ? `${Math.min(100, (last / (l.listCents * 1.15)) * 100)}%` : '4%' }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TickPrice cents={last} className="price-tag !text-base" />
              {l.agreedCents == null && <span className="text-xs font-semibold text-ink-muted">haggling…</span>}
            </span>
            <button type="button" onClick={() => bz.takeOver(l.sku)} className="btn btn-quiet !min-h-10 !px-3 !text-xs">
              Take over
            </button>
          </div>
        </div>
      )}
      {!l.done && l.controlled && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => bz.acceptLane(l.sku)} className="btn btn-teal !min-h-11">
            ✅ Accept at {formatMoney(last)}
          </button>
          <button
            type="button"
            onClick={() => bz.humanOffer(l.sku, Math.round((last * 0.92) / 100) * 100)}
            className="rounded-2xl bg-paper-3 py-3 text-center text-sm font-bold text-ink active:scale-95"
          >
            Counter {formatMoney((last * 0.92) / 100)}
          </button>
        </div>
      )}
    </motion.div>
  );
}

/** A non-interactive echo of a lane card, used only to make the auto-scroll loop seamless. */
function LaneCardGhost({ l }: { l: LaneSummary }) {
  const last = l.priceCents != null ? l.priceCents : l.listCents;
  const agree = l.agreedCents != null;
  return (
    <div
      tabIndex={-1}
      className={cn(
        'rounded-3xl border p-4',
        agree ? 'border-teal/50 bg-teal/10' : l.noDeal ? 'border-chalk bg-paper-2 opacity-70' : 'border-chalk bg-paper-2',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl">{l.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{l.title.en} × {l.qty}</p>
          <p className="t-num text-xs text-ink-faint">{formatMoney(last)}</p>
        </div>
        <Chip ok={agree} noDeal={l.noDeal} running={l.running} controlled={false} />
      </div>
    </div>
  );
}

/**
 * The haggle as a real chat: you on the right, the shop on the left, one
 * bubble per turn. Replaces the old packed right/left-aligned text block —
 * reads like a messaging app at any width, down to a narrow phone.
 */
function ChatTranscript({ turns }: { turns: TurnEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const shown = turns.slice(-10);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length]);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="mt-3 overflow-hidden"
    >
      <ol
        className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-2xl bg-paper-3/60 p-3"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Haggle chat"
      >
        {shown.map((t, i) => {
          const mine = t.actor === 'buyer';
          const last = i === shown.length - 1;
          return (
            <li key={i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 sm:max-w-[75%]',
                  mine ? 'rounded-br-md bg-ink text-paper' : 'rounded-bl-md border border-chalk bg-paper-2 text-ink',
                )}
              >
                {t.priceCents != null && (
                  <p className={cn('t-num text-sm font-bold', mine ? 'text-paper' : 'text-chili')}>
                    {formatMoney(t.priceCents)}
                  </p>
                )}
                <p className={cn('text-sm leading-snug', mine ? 'text-paper/85' : 'text-ink-muted')}>
                  {t.message}
                  {last && <LiveDot />}
                </p>
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>
    </motion.div>
  );
}

function Chip({ ok, noDeal, running, controlled }: { ok: boolean; noDeal: boolean; running: boolean; controlled: boolean }) {
  if (ok) return <span className="rounded-full bg-teal px-3 py-1 text-[11px] font-bold text-white">AGREED</span>;
  if (noDeal) return <span className="rounded-full bg-chalk px-3 py-1 text-[11px] font-bold text-ink-faint">NO DEAL</span>;
  if (controlled) return <span className="rounded-full bg-marigold px-3 py-1 text-[11px] font-bold text-[#23180a]">YOU</span>;
  return (
    <span className="flex items-center gap-1 rounded-full bg-chili/10 px-3 py-1 text-[11px] font-bold text-chili">
      {running ? <LiveDot /> : <span className="h-1.5 w-1.5 rounded-full bg-chalk" />} LIVE
    </span>
  );
}

function LiveDot() {
  return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chili" aria-hidden />;
}

function gsum(n: number) {
  return n === 1 ? '' : 's';
}
