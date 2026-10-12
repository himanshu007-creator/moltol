import { useMemo } from 'react';
import { motion } from 'motion/react';
import { scaleLinear } from 'd3-scale';
import { line, curveStepAfter } from 'd3-shape';
import { max, min } from 'd3-array';
import type { Market } from '@/lib/events';
import type { RevealInfo, Series } from '@/lib/negotiation';
import { formatMoney, formatMoneyCompact } from '@/lib/money';

const W = 600;
const H = 320;
const PAD = { top: 22, right: 54, bottom: 34, left: 16 };

interface Pt {
  i: number;
  v: number | null;
}

/** Forward-fill so both lines are steps that hold until the side moves again. */
function fill(arr: Array<number | null>): Pt[] {
  let last: number | null = null;
  return arr.map((v, i) => {
    if (v != null) last = v;
    return { i, v: last };
  });
}

function pathGen(
  scaleX: (n: number) => number,
  scaleY: (n: number) => number,
  pts: Pt[],
): string | null {
  const gen = line<Pt>()
    .defined((d) => d.v != null)
    .x((d) => scaleX(d.i))
    .y((d) => scaleY(d.v as number))
    .curve(curveStepAfter);
  return gen(pts);
}

/**
 * The offer trajectory (FE_plan §6.3). D3 does the math, React owns the SVG.
 * Before settlement the shop's floor and the buyer's ceiling are NOT in the data
 * we receive, so they cannot leak into this chart (FE_plan §10.2).
 */
export function HaggleChart({
  series,
  market,
  currency,
  reveal,
  agreedPriceCents,
  roundsMax,
}: {
  series: Series;
  market: Market | null;
  currency: string;
  reveal?: RevealInfo;
  agreedPriceCents?: number;
  roundsMax: number;
}) {
  const n = Math.max(series.buyer.length, series.shop.length);

  const { x, y, buyerPts, shopPts, buyerPath, shopPath } = useMemo(() => {
    const buyerPts = fill(series.buyer);
    const shopPts = fill(series.shop);
    const vals = [
      ...series.buyer,
      ...series.shop,
      market?.p25Cents,
      market?.p75Cents,
      reveal?.shopFloorCents,
      reveal?.buyerLimitCents,
      agreedPriceCents,
    ].filter((v): v is number => v != null);
    const rawLo = min(vals) ?? 0;
    const rawHi = max(vals) ?? 1000;
    const span = Math.max(1, rawHi - rawLo);
    const lo = rawLo - span * 0.08;
    const hi = rawHi + span * 0.08;

    const x = scaleLinear()
      .domain([0, Math.max(n - 1, 1)])
      .range([PAD.left, W - PAD.right]);
    const y = scaleLinear()
      .domain([lo, hi])
      .range([H - PAD.bottom, PAD.top]);

    return {
      x,
      y,
      lo,
      hi,
      buyerPts,
      shopPts,
      buyerPath: pathGen((v) => x(v), (v) => y(v), buyerPts),
      shopPath: pathGen((v) => x(v), (v) => y(v), shopPts),
    };
  }, [series, market, reveal, agreedPriceCents, n]);

  const yTicks = y.ticks(4);
  const lastBuyer = [...series.buyer].reverse().find((v) => v != null) ?? null;
  const lastShop = [...series.shop].reverse().find((v) => v != null) ?? null;

  const summary =
    n === 0
      ? 'Offer chart, no rounds yet.'
      : `Offer chart over ${n} rounds. Buyer last offered ${formatMoney(
          lastBuyer ?? 0,
          currency,
        )}, shop last asked ${formatMoney(lastShop ?? 0, currency)}.${
          agreedPriceCents
            ? ` Settled at ${formatMoney(agreedPriceCents, currency)}.`
            : ''
        }`;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={summary}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* price gridlines */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--color-chalk)"
              strokeWidth={1}
            />
            <text
              x={W - PAD.right + 8}
              y={y(t) + 4}
              fill="var(--color-ink-faint)"
              fontSize={12}
              fontFamily="var(--font-mono)"
            >
              {formatMoneyCompact(t, currency)}
            </text>
          </g>
        ))}

        {/* market range band */}
        {market && (
          <g>
            <rect
              x={PAD.left}
              y={y(market.p75Cents)}
              width={W - PAD.right - PAD.left}
              height={Math.max(1, y(market.p25Cents) - y(market.p75Cents))}
              fill="var(--color-indigo)"
              opacity={0.08}
            />
            <text x={PAD.left + 6} y={y(market.p75Cents) - 6} fill="var(--color-ink-faint)" fontSize={11}>
              market range
            </text>
          </g>
        )}

        {/* ZOPA + settled price, only after the reveal */}
        {reveal && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <rect
              x={PAD.left}
              y={y(reveal.buyerLimitCents)}
              width={W - PAD.right - PAD.left}
              height={Math.max(1, y(reveal.shopFloorCents) - y(reveal.buyerLimitCents))}
              fill="var(--color-teal)"
              opacity={0.14}
            />
            <text
              x={W - PAD.right - 6}
              y={y(reveal.buyerLimitCents) + 14}
              textAnchor="end"
              fill="var(--color-teal)"
              fontSize={11}
            >
              ZOPA
            </text>
          </motion.g>
        )}

        {/* the two trajectories */}
        {shopPath && (
          <path d={shopPath} fill="none" stroke="var(--color-chili)" strokeWidth={2.5} strokeLinejoin="round" />
        )}
        {buyerPath && (
          <path d={buyerPath} fill="none" stroke="var(--color-marigold)" strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {/* end markers */}
        {lastShop != null && <circle cx={x(n - 1)} cy={y(lastShop)} r={4} fill="var(--color-chili)" />}
        {lastBuyer != null && <circle cx={x(n - 1)} cy={y(lastBuyer)} r={4} fill="var(--color-marigold)" />}

        {/* settled price pin */}
        {agreedPriceCents != null && (
          <motion.g initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(agreedPriceCents)}
              y2={y(agreedPriceCents)}
              stroke="var(--color-teal)"
              strokeWidth={1.5}
              strokeDasharray="5 5"
            />
            <circle cx={W - PAD.right} cy={y(agreedPriceCents)} r={5} fill="var(--color-teal)" />
            <text
              x={W - PAD.right - 8}
              y={y(agreedPriceCents) - 8}
              textAnchor="end"
              fill="var(--color-teal)"
              fontSize={13}
              fontWeight={700}
              fontFamily="var(--font-mono)"
            >
              {formatMoney(agreedPriceCents, currency)}
            </text>
          </motion.g>
        )}

        {/* x axis */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--color-chalk-strong)"
          strokeWidth={1}
        />
        <text x={PAD.left} y={H - 12} fill="var(--color-ink-faint)" fontSize={11}>
          round 1
        </text>
        <text x={W - PAD.right} y={H - 12} textAnchor="end" fill="var(--color-ink-faint)" fontSize={11}>
          round {roundsMax}
        </text>
      </svg>

      {/* screen-reader table mirror of the chart */}
      <table className="sr-only">
        <caption>Offers by round</caption>
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">Buyer</th>
            <th scope="col">Shop</th>
          </tr>
        </thead>
        <tbody>
          {buyerPts.map((p, i) => (
            <tr key={p.i}>
              <th scope="row">{i + 1}</th>
              <td>{p.v != null ? formatMoney(p.v, currency) : '—'}</td>
              <td>{shopPts[i]?.v != null ? formatMoney(shopPts[i]!.v!, currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-4 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-marigold" /> Buyer
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-chili" /> Shop
        </span>
      </figcaption>
    </figure>
  );
}
