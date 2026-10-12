import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney, formatMoneyCompact, type Cents } from '@/lib/money';
import type { Side, Tactic } from '@/lib/events';
import { chip, mono, sideAccent, tacticLabel } from '@/lib/ui';

/** Prices tick, they don't jump: mono + tabular-nums + a short tick on change. */
export function Price({
  cents,
  currency = 'INR',
  compact = false,
  className,
}: {
  cents: Cents | null | undefined;
  currency?: string;
  compact?: boolean;
  className?: string;
}) {
  if (cents == null) {
    return <span className={cn(mono, 'text-ink-faint', className)}>—</span>;
  }
  return (
    <span key={cents} className={cn(mono, 'animate-tick inline-block', className)}>
      {(compact ? formatMoneyCompact : formatMoney)(cents, currency)}
    </span>
  );
}

const badgeVariants = {
  neutral: 'border-chalk bg-paper text-ink-muted',
  buyer: 'border-marigold/40 bg-marigold/10 text-marigold',
  shop: 'border-chili/40 bg-chili/10 text-chili',
  success: 'border-teal/40 bg-teal/10 text-teal',
  info: 'border-indigo/40 bg-indigo/10 text-indigo',
} as const;

export function Badge({
  children,
  variant = 'neutral',
  className,
}: {
  children: ReactNode;
  variant?: keyof typeof badgeVariants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SideTag({ side, className }: { side: Side; className?: string }) {
  const a = sideAccent(side);
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-semibold', a.text, className)}>
      <span className={cn('h-2.5 w-2.5 rounded-full', a.dot)} aria-hidden="true" />
      {a.label}
    </span>
  );
}

export function TacticChip({ tactic, className }: { tactic: Tactic; className?: string }) {
  return (
    <span className={cn(chip, 'uppercase tracking-wide', className)} title={`tactic: ${tactic}`}>
      {tacticLabel(tactic)}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-teal bg-teal/90' : 'border-chalk-strong bg-paper-3',
      )}
    >
      <span
        className={cn(
          'ml-0.5 h-5 w-5 rounded-full bg-paper-2 shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export function Meter({
  value,
  label,
  tone = 'teal',
}: {
  value: number;
  label?: string;
  tone?: 'teal' | 'marigold' | 'chili';
}) {
  const colors: Record<string, string> = {
    teal: 'bg-teal',
    marigold: 'bg-marigold',
    chili: 'bg-chili',
  };
  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-paper-3"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700', colors[tone])}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
