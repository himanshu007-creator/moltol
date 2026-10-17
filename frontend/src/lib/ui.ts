import { cn } from './cn';
import type { Side, Tactic } from './events';

/**
 * Shared class recipes. Defined ONCE and imported by both .astro and .tsx
 * components so the two worlds can never drift (DRY).
 */

/** Surfaces, buttons, fields and chips. Recipes live in global.css (design system v2). */
export const card = 'surface';

export const panel = 'surface-soft';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal' | 'ink';

export function button(variant: ButtonVariant = 'primary', extra?: string): string {
  const variants: Record<ButtonVariant, string> = {
    primary: 'btn btn-primary',
    secondary: 'btn btn-quiet',
    ghost: 'btn btn-link',
    danger: 'btn btn-chili',
    teal: 'btn btn-teal',
    ink: 'btn btn-ink',
  };
  return cn(variants[variant], extra);
}

export const input = 'field';

export const label = 'block text-sm font-semibold text-ink-muted';

export const chip = 'pill';

export const mono = 'font-mono tabular-nums';

/** Buyer = marigold, shop = chili, consistently, everywhere. */
export function sideAccent(side: Side): { text: string; bg: string; border: string; dot: string; label: string } {
  return side === 'buyer'
    ? {
        text: 'text-marigold',
        bg: 'bg-marigold/10',
        border: 'border-marigold/40',
        dot: 'bg-marigold',
        label: 'Buyer',
      }
    : {
        text: 'text-chili',
        bg: 'bg-chili/10',
        border: 'border-chili/40',
        dot: 'bg-chili',
        label: 'Shop',
      };
}

const tacticLabels: Record<Tactic, string> = {
  anchor: 'anchor',
  bundle: 'bundle',
  'free-delivery': 'free delivery',
  'walk-away-bluff': 'walk-away',
  loyalty: 'loyalty',
  'market-cite': 'market cite',
  'final-offer': 'final offer',
  plain: '',
};

export function tacticLabel(tactic: Tactic): string {
  return tacticLabels[tactic];
}

/** Soft tinted surface using color-mix so it adapts to the theme automatically. */
export function tint(color: string, pct = 12): string {
  return `color-mix(in oklab, var(--color-${color}) ${pct}%, var(--color-paper))`;
}
