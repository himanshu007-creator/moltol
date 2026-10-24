import { scaleBand, scaleLinear } from 'd3-scale';
import { formatMoney } from '@/lib/money';

export interface Bucket {
  label: string;
  revenueCents: number;
  profitCents: number;
}

/**
 * Revenue (light bar) with profit (solid bar) per period. D3 does the scales;
 * React renders the SVG. Bars are static so reduced-motion needs no fallback.
 */
export default function PeriodChart({
  data,
  label,
  legend = ['Revenue', 'Profit'],
}: {
  data: Bucket[];
  label: string;
  legend?: [string, string];
}) {
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 14, b: 30 };
  const x = scaleBand<string>()
    .domain(data.map((d) => d.label))
    .range([pad.l, W - pad.r])
    .padding(0.3);
  const top = Math.max(1, ...data.map((d) => d.revenueCents));
  const y = scaleLinear().domain([0, top]).nice().range([H - pad.b, pad.t]);
  const bw = x.bandwidth();
  const total = data.reduce((s, d) => s + d.revenueCents, 0);

  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${formatMoney(total)} revenue in this view`} className="h-56 w-full">
        {y.ticks(3).map((t) => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-chalk" strokeDasharray="3 4" />
        ))}
        {data.map((d) => {
          const x0 = x(d.label) ?? 0;
          const revH = H - pad.b - y(d.revenueCents);
          const profH = H - pad.b - y(Math.max(0, d.profitCents));
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${legend[0].toLowerCase()} ${formatMoney(d.revenueCents)}, ${legend[1].toLowerCase()} ${formatMoney(d.profitCents)}`}</title>
              <rect x={x0} y={y(d.revenueCents)} width={bw} height={Math.max(0, revH)} rx={6} className="fill-teal/25" />
              <rect x={x0 + bw * 0.25} y={y(Math.max(0, d.profitCents))} width={bw * 0.5} height={Math.max(0, profH)} rx={4} className="fill-marigold" />
              <text x={x0 + bw / 2} y={H - 10} textAnchor="middle" className="fill-ink-faint text-[10px]">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex items-center gap-4 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal/25" />{legend[0]}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-marigold" />{legend[1]}</span>
      </figcaption>
    </figure>
  );
}
