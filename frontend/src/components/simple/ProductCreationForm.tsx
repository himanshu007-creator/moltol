import { useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useSimple, type SimpleUnit } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { s } from '@/lib/simple/strings';
import { speakRupaye, speak } from '@/lib/voice';
import { addShopItem } from '@/lib/backend';
import { BigButton, VoiceCaption, } from './ui';

const UNITS: SimpleUnit[] = ['kg', '500g', 'piece', 'bunch'];
const UNIT_KEY: Record<SimpleUnit, string> = { kg: 'unitKg', '500g': 'unit500g', piece: 'unitPiece', bunch: 'unitBunch' };

export interface ProductSuggestion {
  name: string;
  emoji?: string;
  sellCents?: number;
}

export default function ProductCreationForm({
  initial,
  onBack,
  onDone,
}: {
  initial: ProductSuggestion | null;
  onBack?: () => void;
  onDone?: () => void;
}) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const addProduct = useSimple((x) => x.addProduct);
  const token = useSession((x) => x.token);
  const dict = s(language);

  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial?.sellCents ? String(initial.sellCents / 100) : '');
  const [unit, setUnit] = useState<SimpleUnit>('kg');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellCents = Math.max(0, Math.round(Number(price || '0') * 100));
  const valid = name.trim().length > 0 && sellCents > 0;

  const save = async () => {
    if (!valid || saving) return;
    if (!token) {
      setError('Log in to a real shop to add items.');
      return;
    }
    const floorCents = Math.round((sellCents * 0.75) / 100) * 100;
    setSaving(true);
    setError(null);
    try {
      const item = await addShopItem(token, {
        name: name.trim(),
        sellCents,
        floorCents,
        quantity: Math.max(0, Number(quantity || '0')),
        unit,
      });
      addProduct({
        id: 'cust',
        sellCents,
        floorCents,
        quantity: Math.max(0, Number(quantity || '0')),
        unit,
        hindiName: name.trim(),
        backendItemId: item.id,
      });
      speakRupaye(sellCents, language, { mute });
      speak(dict.v.scanPublish, language, { mute });
      if (onDone) onDone();
      // Soft nav (not location.href): a hard reload can outrun the async IndexedDB
      // write of the product just added, and the new listing is lost on arrival.
      else void navigate('/app/seller/simple/price');
    } catch {
      setError("Couldn't save this item — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
      {onBack && (
        <button type="button" onClick={onBack} className="w-fit text-sm font-medium text-ink-faint">
          ← {dict.u.scanStart}
        </button>
      )}
      <h1 className="mt-2 text-2xl font-semibold text-ink">{dict.u.formTitle}</h1>

      <div className="mt-4 flex items-center gap-4 surface p-5">
        <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-paper-3 text-4xl">{initial?.emoji ?? '📷'}</span>
        <div className="flex-1">
          <p className="text-lg font-semibold text-ink">{name || dict.u.formName}</p>
        </div>
      </div>

      <VoiceCaption voice={dict.v.scanPublish} />

      <label className="mt-4 block">
        <span className="text-sm font-medium text-ink-faint">{dict.u.formName}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full surface px-4 py-4 text-lg text-ink placeholder:text-ink-faint"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-sm font-medium text-ink-faint">{dict.u.formPrice}</span>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          placeholder="₹"
          className="mt-1 w-full surface px-4 py-4 text-2xl font-semibold text-ink placeholder:text-ink-faint"
        />
      </label>

      <div className="mt-3">
        <span className="text-sm font-medium text-ink-faint">{dict.u.formUnit}</span>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`rounded-2xl py-3 text-sm font-semibold ${unit === u ? 'bg-marigold/30 ring-2 ring-marigold text-ink' : 'bg-paper-2 text-ink-faint'}`}
            >
              {dict.u[UNIT_KEY[u]]}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block">
        <span className="text-sm font-medium text-ink-faint">{dict.u.formQty}</span>
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          className="mt-1 w-full surface px-4 py-4 text-lg text-ink"
        />
      </label>

      {error && <p role="alert" className="mt-3 text-sm font-medium text-chili">{error}</p>}

      <div className="mt-auto pt-6">
        <BigButton onClick={() => void save()} disabled={!valid || saving}>
          {saving ? '…' : dict.u.publish}
        </BigButton>
      </div>
    </div>
  );
}
