import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { navigate } from 'astro:transitions/client';
import {
  CookingPot,
  Flame,
  Milk,
  Shirt,
  Soup,
  Store,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { PRODUCTS, getProduct, getShop, type Product } from '@/lib/catalog';
import { getComps, type Comps } from '@/lib/market';
import { formatMoney, parseMoneyToCents } from '@/lib/money';
import { button, card, chip, input as inputCls, label as labelCls, mono } from '@/lib/ui';
import { cn } from '@/lib/cn';
import { Badge, Toggle } from '@/components/react/ui';
import { useI18n } from '@/stores/prefs';

const ICONS: Record<string, LucideIcon> = {
  milk: Milk,
  'cooking-pot': CookingPot,
  soup: Soup,
  flame: Flame,
  shirt: Shirt,
  utensils: Utensils,
};

const schema = z.object({
  productId: z.string().min(1),
  customItem: z.string().optional(),
  ceiling: z.string().min(1),
  askBefore: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export default function BuyForm() {
  const { t } = useI18n();
  const [comps, setComps] = useState<Comps | null>(null);

  const { register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { productId: PRODUCTS[0]?.id ?? '', customItem: '', ceiling: '', askBefore: true },
  });

  const productId = watch('productId');
  const askBefore = watch('askBefore');
  const ceilingRaw = watch('ceiling');
  const product = getProduct(productId);
  const shop = product ? getShop(product.shopId) : undefined;

  useEffect(() => {
    let live = true;
    if (!product) return;
    void getComps(product.id).then((c) => live && setComps(c));
    return () => {
      live = false;
    };
  }, [product]);

  const ceilingCents = parseMoneyToCents(ceilingRaw ?? '');
  const overBudget = product && ceilingCents != null && ceilingCents > product.listPriceCents + 1;

  const grouped = useMemo(() => PRODUCTS, []);

  const onSubmit = (values: FormValues) => {
    const cents = parseMoneyToCents(values.ceiling);
    if (cents == null) return;
    const pid = values.customItem?.trim() ? productId : values.productId;
    const id = `n-${Math.random().toString(36).slice(2, 10)}`;
    const qs = new URLSearchParams({ id, product: pid, max: String(cents), mode: 'engine' });
    navigate(`/app/haggle?${qs.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <fieldset>
          <legend className={cn(labelCls, 'mb-3 text-base text-ink')}>{t('buy.what')}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {grouped.map((p: Product) => {
              const Icon = ICONS[p.icon] ?? Utensils;
              const active = productId === p.id;
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setValue('productId', p.id);
                    const cap = Math.round(p.listPriceCents * 0.92);
                    setValue('ceiling', (cap / 100).toFixed(2));
                  }}
                  aria-pressed={active}
                  className={cn(
                    card,
                    'flex flex-col items-start gap-2 p-3.5 text-left transition',
                    active ? 'ring-2 ring-marigold' : 'hover:-translate-y-0.5',
                  )}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-marigold/15 text-marigold">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold leading-snug text-ink">{p.title}</span>
                  <span className={cn(mono, 'text-xs text-ink-faint')}>
                    list {formatMoney(p.listPriceCents, p.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="ceiling" className={cn(labelCls, 'mb-1.5')}>
            {t('buy.budget')}
          </label>
          <div className="relative">
            <span className={cn(mono, 'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint')}>
              $
            </span>
            <input
              id="ceiling"
              inputMode="decimal"
              autoComplete="off"
              placeholder="20.00"
              className={cn(inputCls, mono, 'pl-7 text-lg')}
              {...register('ceiling')}
            />
          </div>
          {overBudget && (
            <p className="mt-1.5 text-xs text-chili">
              Above the list price — the agent will simply pay list. That’s allowed, just wasteful.
            </p>
          )}
          <p className="mt-1.5 text-xs text-ink-faint">{t('buy.hint')}</p>
          {formState.errors.ceiling && (
            <p className="mt-1 text-xs text-chili">Give the agent a ceiling to work with.</p>
          )}
        </div>

        <div className={cn(card, 'flex items-center justify-between gap-4 p-4')}>
          <div>
            <p className="text-sm font-semibold text-ink">{t('buy.askBefore')}</p>
            <p className="text-xs text-ink-faint">We’ll pause before the PayPal charge so you approve the price.</p>
          </div>
          <Toggle checked={askBefore} onChange={(v) => setValue('askBefore', v)} label="Ask before paying" />
        </div>
      </div>

      {/* summary rail */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className={cn(card, 'p-5')}>
          <h2 className="text-sm font-semibold text-ink">{product?.title ?? 'Pick an item'}</h2>
          {shop && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              {shop.displayName}
            </p>
          )}

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">{t('buy.market')}</dt>
              <dd className={cn(mono, 'text-ink')}>
                {comps
                  ? `${formatMoney(comps.market.p25Cents)}–${formatMoney(comps.market.p75Cents)}`
                  : '…'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">Median nearby</dt>
              <dd className={cn(mono, 'text-ink')}>{comps ? formatMoney(comps.market.medianCents) : '…'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">Your ceiling</dt>
              <dd className={cn(mono, 'font-semibold text-marigold')}>
                {ceilingCents != null ? formatMoney(ceilingCents) : '—'}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="info">Channel3 comps</Badge>
            <span className={chip}>sealed limit</span>
          </div>

          <button type="submit" className={cn(button('primary'), 'mt-5 w-full')}>
            {t('buy.start')}
          </button>
        </div>
      </aside>
    </form>
  );
}
