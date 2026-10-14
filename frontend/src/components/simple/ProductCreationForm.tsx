import { useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useSimple, type SimpleUnit } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { s, type ItemId } from '@/lib/simple/strings';
import { speakRupaye, speak } from '@/lib/voice';
import { vegName, type VegSpec } from '@/lib/vision/catalog';
import { addShopItem } from '@/lib/backend';
import { BigButton, VoiceCaption, } from './ui';

const UNITS: SimpleUnit[] = ['kg', '500g', 'piece', 'bunch'];
const UNIT_KEY: Record<SimpleUnit, string> = { kg: 'unitKg', '500g': 'unit500g', piece: 'unitPiece', bunch: 'unitBunch' };

export default function ProductCreationForm({
  initialVeg,
  onBack,
  onDone,
}: {
  initialVeg: VegSpec | null;
  onBack?: () => void;
  onDone?: () => void;
}) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const addProduct = useSimple((x) => x.addProduct);
  const setBackendId = useSimple((x) => x.setBackendId);
  const token = useSession((x) => x.token);
  const dict = s(language);

  const [name, setName] = useState(initialVeg ? vegName(initialVeg, language) : '');
  const [hindiName, setHindiName] = useState(initialVeg ? initialVeg.en : '');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<SimpleUnit>('kg');
  const [quantity, setQuantity] = useState('1');

  const sellCents = Math.max(0, Math.round(Number(price || '0') * 100));
  const valid = name.trim().length > 0 && sellCents > 0;

  const save = () => {
    if (!valid) return;
    const id: ItemId = initialVeg ? initialVeg.id : 'cust';
    const floorCents = Math.round((sellCents * 0.75) / 100) * 100;
    addProduct({
      id,
      sellCents,
      floorCents,
      quantity: Math.max(0, Number(quantity || '0')),
      unit,
      hindiName: hindiName.trim() || undefined,
      image: initialVeg?.image,
      vegKey: initialVeg?.key,
    });
    // Local store is the source of truth for the UI; the backend write is
    // additive and never blocks it — same fail-soft pattern already used for
    // the live market-comps lookup elsewhere in this flow.
    if (token) {
      void addShopItem(token, {
        name: name.trim(),
        sellCents,
        floorCents,
        quantity: Math.max(0, Number(quantity || '0')),
        unit,
        hindiName: hindiName.trim() || undefined,
      })
        .then((item) => setBackendId(id, item.id))
        .catch(() => {});
    }
    speakRupaye(sellCents, language, { mute });
    speak(dict.v.scanPublish, language, { mute });
    if (onDone) onDone();
    // Soft nav (not location.href): a hard reload can outrun the async IndexedDB
    // write of the product just added, and the new listing is lost on arrival.
    else void navigate('/app/seller/simple/price');
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
        {initialVeg ? (
          <img src={initialVeg.image} alt="" width={80} height={80} className="h-20 w-20 rounded-2xl" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-paper-3 text-4xl">📷</span>
        )}
        <div className="flex-1">
          <p className="text-lg font-semibold text-ink">{name || dict.u.formName}</p>
          <p className="text-sm text-ink-faint">{hindiName || '—'}</p>
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
        <span className="text-sm font-medium text-ink-faint">{dict.u.formHindi}</span>
        <input
          value={hindiName}
          onChange={(e) => setHindiName(e.target.value)}
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

      <div className="mt-auto pt-6">
        <BigButton onClick={save} disabled={!valid}>
          {dict.u.publish}
        </BigButton>
      </div>
    </div>
  );
}
