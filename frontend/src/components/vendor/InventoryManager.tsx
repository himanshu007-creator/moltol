import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInventory } from '@/stores/inventory';
import { useSession } from '@/stores/session';
import type { ShopItem } from '@/lib/backend';
import { marginPct } from '@/lib/inventory';
import { formatMoney } from '@/lib/money';
import { UNITS, formatQty, roundQty, type UnitId } from '@/lib/units';
import { cn } from '@/lib/cn';
import AddItem from '@/components/vendor/AddItem';
import ItemForm, { EMPTY_FORM, type FormValues } from '@/components/vendor/ItemForm';

type Tab = 'stock' | 'add';
type Filter = 'all' | 'low' | 'out' | 'archived';
const REASONS = ['Restock', 'Counted', 'Spoiled', 'Sold outside app'] as const;

function isLow(i: ShopItem) {
  const qty = i.quantity ?? 0;
  return !i.archived && qty > 0 && qty <= (i.lowStockAt ?? 0);
}

function toForm(i: ShopItem): FormValues {
  return {
    photo: '',
    name: i.name,
    category: i.category ?? 'general',
    emoji: i.emoji ?? '🛒',
    unit: (i.unit ?? 'kg') as UnitId,
    customUnit: i.customUnit ?? '',
    packSize: i.packSize ? String(i.packSize) : '',
    qty: String(i.quantity ?? 0),
    cost: String((i.costCents ?? 0) / 100),
    min: String(i.floorCents / 100),
    list: String(i.sellCents / 100),
    lowStockAt: String(i.lowStockAt ?? 5),
  };
}

/** Vendor inventory: add (4 ways), list with stock adjust, edit and bulk list-price changes. */
export default function InventoryManager() {
  const items = useInventory((s) => s.items);
  const log = useInventory((s) => s.log);
  const loaded = useInventory((s) => s.loaded);
  const fetchItems = useInventory((s) => s.fetch);
  const adjust = useInventory((s) => s.adjust);
  const bulkListPct = useInventory((s) => s.bulkListPct);
  const setArchived = useInventory((s) => s.setArchived);
  const token = useSession((s) => s.token);

  const [tab, setTab] = useState<Tab>('stock');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('Restock');
  const [picked, setPicked] = useState<string[]>([]);
  const [form, setForm] = useState<{ key: number; values: FormValues; editingId?: string }>({ key: 0, values: EMPTY_FORM });

  useEffect(() => {
    if (token && !loaded) void fetchItems(token);
  }, [token, loaded, fetchItems]);

  const counts = useMemo(
    () => ({
      active: items.filter((i) => !i.archived).length,
      low: items.filter(isLow).length,
      out: items.filter((i) => !i.archived && (i.quantity ?? 0) === 0).length,
      archived: items.filter((i) => i.archived).length,
    }),
    [items],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'archived' ? !i.archived : i.archived) return false;
      if (filter === 'low' && !isLow(i)) return false;
      if (filter === 'out' && !((i.quantity ?? 0) === 0 && !i.archived)) return false;
      return !q || i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const openForm = (values: FormValues, editingId?: string) => {
    setForm((f) => ({ key: f.key + 1, values, editingId }));
    setTab('add');
  };

  return (
    <div className="grid gap-6 pb-32">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-label">Vendor console</p>
          <h1 className="t-h1">Inventory</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {counts.active} items · {counts.low} low · {counts.out} out. Out-of-stock items hide from buyers automatically.
          </p>
        </div>
        <div role="tablist" aria-label="Inventory views" className="flex rounded-2xl bg-paper-3 p-1">
          {(['stock', 'add'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              type="button"
              onClick={() => setTab(t)}
              className={cn('min-h-11 rounded-xl px-4 text-sm font-semibold', tab === t ? 'bg-ink text-paper' : 'text-ink')}
            >
              {t === 'stock' ? `Stock (${counts.active})` : 'Add items'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'add' && (
        <div className="grid gap-6">
          <AddItem onPrefill={(v) => openForm({ ...EMPTY_FORM, ...v })} />
          <div className="surface p-4 sm:p-6">
            <h2 className="mb-4 font-display text-xl text-ink">{form.editingId ? 'Edit item' : 'Item details'}</h2>
            <ItemForm
              key={form.key}
              initial={form.values}
              editingId={form.editingId}
              onDone={() => {
                setForm({ key: form.key + 1, values: EMPTY_FORM });
                setTab('stock');
              }}
            />
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <section aria-label="Stock list" className="grid gap-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items"
            aria-label="Search items"
            className="field sm:max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'low', 'out', 'archived'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn('min-h-11 rounded-full px-4 text-sm font-medium', filter === f ? 'bg-ink text-paper' : 'bg-paper-3 text-ink')}
              >
                {({ all: 'All', low: `Low (${counts.low})`, out: `Out (${counts.out})`, archived: `Archived (${counts.archived})` } as const)[f]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2 text-ink-faint">
              Reason for stock changes
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                className="min-h-11 rounded-xl border border-chalk bg-paper px-2 text-base text-ink"
              >
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>

          {picked.length > 0 && (
            <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink p-3 text-paper">
              <span className="px-2 text-sm font-medium">{picked.length} selected</span>
              <button type="button" className="min-h-11 rounded-xl bg-paper/15 px-3 text-sm" onClick={() => { if (token) void bulkListPct(token, picked, 5); }}>
                List +5%
              </button>
              <button type="button" className="min-h-11 rounded-xl bg-paper/15 px-3 text-sm" onClick={() => { if (token) void bulkListPct(token, picked, -5); }}>
                List −5%
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!token) return;
                  void setArchived(token, picked, filter !== 'archived').then(() => setPicked([]));
                }}
                className="min-h-11 rounded-xl bg-paper/15 px-3 text-sm"
              >
                {filter === 'archived' ? 'Restore' : 'Archive'}
              </button>
              <button type="button" className="min-h-11 rounded-xl px-3 text-sm underline" onClick={() => setPicked([])}>
                Clear
              </button>
            </div>
          )}

          {shown.length === 0 && <p className="surface p-6 text-center text-sm text-ink-faint">Nothing here. Add an item from “Add items”.</p>}

          <ul className="grid gap-3">
            {shown.map((i) => {
              const unit = (i.unit ?? 'kg') as UnitId;
              const step = UNITS[unit].step;
              const m = marginPct(i.sellCents, i.costCents ?? 0);
              const qty = i.quantity ?? 0;
              return (
                <li key={i.id} className={cn('grid gap-3 surface p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center', i.archived && 'opacity-60')}>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-marigold"
                      checked={picked.includes(i.id)}
                      onChange={() => toggle(i.id)}
                      aria-label={`Select ${i.name}`}
                    />
                    <span className="text-3xl" aria-hidden="true">{i.emoji ?? '🛒'}</span>
                  </label>

                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {i.name}
                      {qty === 0 && !i.archived && <Chip tone="chili">Out</Chip>}
                      {isLow(i) && <Chip tone="marigold">Low</Chip>}
                      {i.archived && <Chip tone="ink">Archived</Chip>}
                    </p>
                    <p className="text-xs text-ink-faint">{i.category ?? 'general'} · cost {formatMoney(i.costCents ?? 0)} · lowest <span className="text-chili">{formatMoney(i.floorCents)}</span> · margin {m}%</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-ink">
                      {formatMoney(i.sellCents)} <span className="text-xs font-normal text-ink-faint">per {unit === 'custom' ? i.customUnit : UNITS[unit].label}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <div className="flex items-center rounded-2xl bg-paper-3 p-1" role="group" aria-label={`Stock for ${i.name}`}>
                      <button type="button" aria-label="Remove one step" disabled={qty <= 0 || !!i.archived} onClick={() => token && void adjust(token, i.id, -step, reason)} className="h-11 w-11 rounded-xl bg-paper text-lg font-bold disabled:opacity-40">−</button>
                      <span className="min-w-[5rem] text-center text-sm font-semibold tabular-nums text-ink">{formatQty(roundQty(qty), unit, i.customUnit ?? undefined)}</span>
                      <button type="button" aria-label="Add one step" disabled={!!i.archived} onClick={() => token && void adjust(token, i.id, step, reason)} className="h-11 w-11 rounded-xl bg-paper text-lg font-bold disabled:opacity-40">+</button>
                    </div>
                    <button type="button" onClick={() => openForm(toForm(i), i.id)} className="min-h-11 rounded-xl px-3 text-sm font-medium text-indigo underline">
                      Edit
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {log.length > 0 && (
            <details className="surface p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Stock log ({log.length})</summary>
              <ul className="mt-3 grid gap-1 text-xs text-ink-faint">
                {log.slice(0, 12).map((l) => (
                  <li key={l.id}>
                    {new Date(l.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {items.find((i) => i.id === l.sku)?.name ?? l.sku} {l.delta > 0 ? '+' : ''}
                    {roundQty(l.delta)} · {l.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: 'chili' | 'marigold' | 'ink' }) {
  const cls = { chili: 'bg-chili/15 text-chili', marigold: 'bg-marigold/25 text-warn', ink: 'bg-ink/10 text-ink' }[tone];
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', cls)}>{children}</span>;
}
