import { useMemo, useState, type ChangeEvent } from 'react';
import { useInventory, type NewItem } from '@/stores/inventory';
import { checkPrices } from '@/lib/inventory';
import { formatMoney, parseMoneyToCents } from '@/lib/money';
import { UNITS, UNIT_IDS, clampQty, type UnitId } from '@/lib/units';
import { cn } from '@/lib/cn';
import { toThumb } from '@/lib/vision';

export interface FormValues {
  photo: string;
  name: string;
  category: string;
  emoji: string;
  unit: UnitId;
  customUnit: string;
  packSize: string;
  qty: string;
  cost: string;
  min: string;
  list: string;
  lowStockAt: string;
  compKey?: string;
}

export const EMPTY_FORM: FormValues = {
  photo: '',
  name: '',
  category: 'general',
  emoji: '🛒',
  unit: 'kg',
  customUnit: '',
  packSize: '',
  qty: '',
  cost: '',
  min: '',
  list: '',
  lowStockAt: '5',
};

const EMOJIS = ['🍅', '🧅', '🥔', '🌿', '🍋', '🥚', '🥛', '🍌', '🫘', '🌾', '🫒', '🛒'];

const field = 'min-h-11 w-full rounded-2xl border border-chalk bg-paper px-3 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-marigold';
const label = 't-label';

/** Validates the form and returns a NewItem, or the first friendly error per field. */
export function toDraft(v: FormValues): { draft?: NewItem; errors: Partial<Record<keyof FormValues, string>>; prices?: ReturnType<typeof checkPrices> } {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Give the item a name.';
  const qty = Number(v.qty || 0);
  if (!Number.isFinite(qty) || qty < 0) errors.qty = 'Enter a quantity of 0 or more.';
  const cost = parseMoneyToCents(v.cost);
  const min = parseMoneyToCents(v.min);
  const list = parseMoneyToCents(v.list);
  if (cost == null) errors.cost = 'What did you pay per unit?';
  if (min == null) errors.min = 'Lowest price you will accept.';
  if (list == null || list <= 0) errors.list = 'Price you show on the stall.';
  if (v.unit === 'custom' && !v.customUnit.trim()) errors.customUnit = 'Name the unit, e.g. “bag”.';

  // cost vs lowest price is checked as soon as both exist; the list price rule waits for the list price
  if (cost != null && min != null) {
    const low = checkPrices({ costCents: cost, minCents: min, listCents: Math.max(list ?? 0, min) });
    if (low.minError) errors.min = low.minError;
  }
  let prices: ReturnType<typeof checkPrices> | undefined;
  if (cost != null && min != null && list != null) {
    prices = checkPrices({ costCents: cost, minCents: min, listCents: list });
    if (prices.listError) errors.list = prices.listError;
  }
  if (Object.keys(errors).length || cost == null || min == null || list == null) return { errors, prices };

  return {
    errors,
    prices,
    draft: {
      name: v.name.trim(),
      category: v.category.trim() || 'general',
      emoji: v.emoji,
      unit: v.unit,
      customUnit: v.unit === 'custom' ? v.customUnit.trim() : undefined,
      packSize: v.packSize && Number(v.packSize) > 0 ? Number(v.packSize) : undefined,
      qty: clampQty(qty, v.unit),
      costCents: cost,
      minCents: min,
      listCents: list,
      lowStockAt: Number(v.lowStockAt) >= 0 ? Number(v.lowStockAt) : 5,
      compKey: v.compKey,
      photo: v.photo || undefined,
    },
  };
}

/** Add or edit one item. Live validation, margin preview and the red-line price ruler. */
export default function ItemForm({
  initial,
  editingId,
  onDone,
}: {
  initial: FormValues;
  editingId?: string;
  onDone: () => void;
}) {
  const [v, setV] = useState<FormValues>(initial);
  const [touched, setTouched] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  // a field's error shows once the user has edited it; any price edit reveals the price rules
  const [dirty, setDirty] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const add = useInventory((s) => s.add);
  const update = useInventory((s) => s.update);

  const { draft, errors, prices } = useMemo(() => toDraft(v), [v]);
  const set = (k: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    setDirty((d) => ({ ...d, [k]: true }));
  };
  const PRICE_KEYS: Array<keyof FormValues> = ['cost', 'min', 'list'];
  const priceEdited = PRICE_KEYS.some((k) => dirty[k]);
  const shownErr = (k: keyof FormValues) =>
    touched || dirty[k] || (PRICE_KEYS.includes(k) && priceEdited) ? errors[k] : undefined;
  const cost = parseMoneyToCents(v.cost);
  const min = parseMoneyToCents(v.min);
  const list = parseMoneyToCents(v.list);

  const save = () => {
    setTouched(true);
    if (!draft) return;
    if (editingId) update(editingId, draft);
    else add(draft);
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <div className="flex items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-3xl bg-paper-3 text-4xl">
          {v.photo ? <img src={v.photo} alt="Item photo" className="h-full w-full object-cover" /> : <span aria-hidden="true">{v.emoji}</span>}
        </div>
        <div className="grid gap-2">
          <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-2xl bg-paper-3 px-4 text-sm font-semibold text-ink">
            📷 {v.photo ? 'Change photo' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const photo = await toThumb(f);
                  setV((cur) => ({ ...cur, photo }));
                  setPhotoErr(null);
                } catch {
                  setPhotoErr('Could not read that photo. Try another.');
                }
              }}
            />
          </label>
          {v.photo && (
            <button type="button" onClick={() => setV((cur) => ({ ...cur, photo: '' }))} className="min-h-11 w-fit rounded-2xl px-3 text-sm font-medium text-chili underline">
              Remove photo
            </button>
          )}
          {photoErr && <p role="alert" className="text-xs text-chili">{photoErr}</p>}
        </div>
      </div>

      <div className="grid gap-2">
        <span className={label}>Icon</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Icon">
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              role="radio"
              aria-checked={v.emoji === em}
              onClick={() => setV({ ...v, emoji: em })}
              className={cn('h-11 w-11 rounded-2xl text-2xl', v.emoji === em ? 'bg-marigold/40 ring-2 ring-marigold' : 'bg-paper-3')}
            >
              {em}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={label}>Name</span>
          <input className={field} value={v.name} onChange={set('name')} placeholder="Tomatoes" aria-invalid={!!shownErr('name')} />
          <Err msg={shownErr('name')} />
        </label>
        <label className="grid gap-1.5">
          <span className={label}>Category</span>
          <input className={field} value={v.category} onChange={set('category')} list="cats" />
          <datalist id="cats">
            <option value="vegetable" /><option value="fruit" /><option value="dairy" /><option value="grocery" />
          </datalist>
        </label>
        <label className="grid gap-1.5">
          <span className={label}>Quantity in stock</span>
          <input className={field} inputMode="decimal" value={v.qty} onChange={set('qty')} placeholder="0" aria-invalid={!!shownErr('qty')} />
          <Err msg={shownErr('qty')} />
        </label>
        <label className="grid gap-1.5">
          <span className={label}>Unit</span>
          <select className={field} value={v.unit} onChange={set('unit')}>
            {UNIT_IDS.map((u) => (
              <option key={u} value={u}>
                {UNITS[u].label === 'unit' ? 'custom' : UNITS[u].label}
              </option>
            ))}
          </select>
        </label>
        {v.unit === 'custom' && (
          <label className="grid gap-1.5">
            <span className={label}>Unit name</span>
            <input className={field} value={v.customUnit} onChange={set('customUnit')} placeholder="bag" aria-invalid={!!shownErr('customUnit')} />
            <Err msg={shownErr('customUnit')} />
          </label>
        )}
        {(v.unit === 'pack' || v.unit === 'custom') && (
          <label className="grid gap-1.5">
            <span className={label}>Pack size (g or ml, optional)</span>
            <input className={field} inputMode="numeric" value={v.packSize} onChange={set('packSize')} placeholder="100" />
          </label>
        )}
      </div>

      <fieldset className="grid gap-3 rounded-3xl border border-chalk p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Prices (₹ per {v.unit === 'custom' ? v.customUnit || 'unit' : UNITS[v.unit].label})</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className={label}>Cost (what you paid)</span>
            <input className={cn(field, 'font-mono tabular-nums')} inputMode="decimal" value={v.cost} onChange={set('cost')} placeholder="0" aria-invalid={!!shownErr('cost')} />
            <Err msg={shownErr('cost')} />
          </label>
          <label className="grid gap-1.5">
            <span className={label}>Lowest price (seller only)</span>
            <input className={cn(field, 'font-mono tabular-nums')} inputMode="decimal" value={v.min} onChange={set('min')} placeholder="0" aria-invalid={!!shownErr('min')} aria-describedby="min-help" />
            <span id="min-help" className="text-[11px] text-ink-faint">Never shown to buyers.</span>
            <Err msg={shownErr('min')} />
          </label>
          <label className="grid gap-1.5">
            <span className={label}>List price</span>
            <input className={cn(field, 'font-mono tabular-nums')} inputMode="decimal" value={v.list} onChange={set('list')} placeholder="0" aria-invalid={!!shownErr('list')} />
            <Err msg={shownErr('list')} />
          </label>
        </div>

        {list != null && list > 0 && <PriceRail cost={cost} min={min} list={list} />}

        {prices && cost != null && min != null && list != null && (
          <p className="text-xs text-ink-faint" aria-live="polite">
            Margin preview: at your lowest price you keep <b className="text-ink">{prices.floorMarginPct}%</b>, at list{' '}
            <b className="text-ink">{prices.listMarginPct}%</b>.
          </p>
        )}
      </fieldset>

      <label className="grid max-w-xs gap-1.5">
        <span className={label}>Low-stock alert below</span>
        <input className={cn(field, 'font-mono')} inputMode="decimal" value={v.lowStockAt} onChange={set('lowStockAt')} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="min-h-11 rounded-2xl bg-marigold px-6 py-2.5 font-semibold text-[#23180a] active:scale-95 disabled:opacity-40" disabled={touched && !draft}>
          {editingId ? 'Save changes' : 'Add to stall'}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 rounded-2xl px-4 text-sm font-medium text-ink-faint">
          Cancel
        </button>
        {!touched && !draft && <span className="text-xs text-ink-faint">Fill the highlighted fields to continue.</span>}
        {touched && !draft && <span className="text-xs text-chili">Fix the errors above to save.</span>}
      </div>
    </form>
  );
}

function Err({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <span role="alert" className="text-xs font-medium text-chili">
      {msg}
    </span>
  );
}

/** Horizontal price ruler: cost (grey), lowest price (red line, seller only), list (teal). */
export function PriceRail({ cost, min, list }: { cost: number | null; min: number | null; list: number }) {
  const top = Math.max(list, min ?? 0, cost ?? 0) * 1.15;
  const pct = (c: number) => Math.min(100, Math.max(0, (c / top) * 100));
  return (
    <div aria-hidden="true" className="relative mt-2 h-14 select-none">
      <div className="absolute inset-x-0 top-6 h-2 rounded-full bg-chalk" />
      {cost != null && (
        <Tick left={pct(cost)} color="bg-ink-faint" text={`cost ${formatMoney(cost)}`} />
      )}
      {min != null && <Tick left={pct(min)} color="bg-chili" text={`min ${formatMoney(min)}`} strong />}
      <Tick left={pct(list)} color="bg-teal" text={`list ${formatMoney(list)}`} />
    </div>
  );
}

function Tick({ left, color, text, strong }: { left: number; color: string; text: string; strong?: boolean }) {
  return (
    <div className="absolute top-0 -translate-x-1/2" style={{ left: `${left}%` }}>
      <span className={cn('block text-[10px] font-semibold text-ink-faint whitespace-nowrap', strong && 'text-chili')}>{text}</span>
      <span className={cn('mx-auto mt-0.5 block h-7 w-1 rounded-full', color)} />
    </div>
  );
}
