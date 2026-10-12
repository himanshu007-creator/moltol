import TickPrice from '@/components/motion/TickPrice';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useBazaar, selectBazaar } from '@/stores/bazaar';
import { formatMoney } from '@/lib/money';
import { whenHydrated } from '@/lib/hydrated';

export default function BazaarTheatre() {
  const bz = useBazaar();
  const sum = useMemo(() => selectBazaar(bz), [bz]);
  const [chat, setChat] = useState<string | null>(null);

  // A full-reload nav (location.href from /cart) kills the store clock — restart it,
  // but only once the store has actually hydrated from IndexedDB: calling resume()
  // too early sees the pre-hydration default state (stage 'idle'), its guard
  // no-ops, and nothing ever retries.
  useEffect(() => whenHydrated(useBazaar, () => useBazaar.getState().resume()), []);

  if (bz.stage === 'idle') {
    return (
      <div className="flex flex-col items-center gap-3 surface p-8 text-center">
        <span className="text-5xl">🤝</span>
        <p className="text-lg font-semibold text-ink">No live haggle yet</p>
        <a href="/app/cart" className="rounded-full bg-chili px-5 py-2.5 text-sm font-bold text-white">
          Pick items in your basket →
        </a>
      </div>
    );
  }

  const agreed = sum.lanes.filter((l) => l.done && !l.noDeal);
  const live = sum.lanes.filter((l) => !l.done);

  return (
    <div className="pb-48">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-display font-extrabold text-ink">Live bazaar</h1>
        <span className="rounded-full bg-chili/10 px-3 py-1 text-xs font-bold text-chili">
          {bz.style} · {sum.totalDone} lanes
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <AnimatePresence initial={false}>
          {sum.lanes.map((l) => {
            const last = l.priceCents != null ? l.priceCents : l.listCents;
            const agree = l.agreedCents != null;
            return (
              <motion.div
                key={l.sku}
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
                  <button
                    type="button"
                    onClick={() => setChat(chat === l.sku ? null : l.sku)}
                    className="mt-3 w-full rounded-2xl bg-paper-3/60 px-3 py-2 text-left text-sm text-ink-muted"
                  >
                    💬 {l.turns[l.turns.length - 1]!.message}
                    {l.fairness > 0 && <span className="float-right text-teal">fair {l.fairness}%</span>}
                  </button>
                )}

                <AnimatePresence>
                  {chat === l.sku && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mt-2 space-y-1 overflow-hidden rounded-2xl bg-paper-3 px-3 py-2 text-xs text-ink-muted"
                    >
                      {l.turns.slice(-5).map((t, i) => (
                        <li key={i} className={t.actor === 'buyer' ? 'text-right' : ''}>
                          <b className={t.actor === 'buyer' ? 'text-ink' : 'text-chili'}>
                            {t.actor === 'buyer' ? 'you' : 'shop'}
                          </b>{' '}
                          {t.priceCents != null && <span className="tabular-nums">{formatMoney(t.priceCents)}</span>} — {t.message}
                          {i === l.turns.length - 1 && <LiveDot />}
                        </li>
                      ))}
                    </motion.ul>
                  )}
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
                    <button
                      type="button"
                      onClick={() => bz.acceptLane(l.sku)}
                      className="btn btn-teal !min-h-11"
                    >
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
          })}
        </AnimatePresence>
      </div>

      {sum.noDealCount > 0 && !live.length && (
        <div className="mt-4 surface p-4 text-sm text-ink-muted">
          ⚖️ {sum.noDealCount} item{gsum(sum.noDealCount)} hit the no-deal red line. The agent never overpays — that’s the proof.
        </div>
      )}

      {/* sticky summary */}
      {agreed.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 px-4">
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