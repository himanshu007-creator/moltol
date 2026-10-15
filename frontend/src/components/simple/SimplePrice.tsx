import { useRef } from 'react';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { s, nativeRupaye, itemName, SIMPLE_ITEMS } from '@/lib/simple/strings';
import { speakRupaye } from '@/lib/voice';
import { updateShopItem } from '@/lib/backend';

const SYNC_DEBOUNCE_MS = 600;

export default function SimplePrice() {
  const { products, setPrice, language, mute } = useSimple();
  const token = useSession((x) => x.token);
  const dict = s(language);
  const items = products.map((p) => ({
    ...p,
    def: SIMPLE_ITEMS.find((i) => i.id === p.id) ?? SIMPLE_ITEMS[0]!,
  }));

  // A range slider fires on every pixel of drag — sync to the backend only
  // once the user pauses, not on every tick, one timer per item.
  const syncTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleSync = (backendItemId: string, sellCents: number, floorCents: number) => {
    clearTimeout(syncTimers.current[backendItemId]);
    syncTimers.current[backendItemId] = setTimeout(() => {
      void updateShopItem(token!, backendItemId, { sellCents, floorCents }).catch(() => {});
    }, SYNC_DEBOUNCE_MS);
  };

  const set = (id: typeof products[number]['id'], sellCents: number, floorCents: number) => {
    setPrice(id, sellCents, floorCents);
    speakRupaye(sellCents, language, { mute });
    const backendItemId = products.find((p) => p.id === id)?.backendItemId;
    if (token && backendItemId) scheduleSync(backendItemId, sellCents, floorCents);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">{dict.u.homeToday}</h1>
        <a href="/app/seller/simple/scan" className="flex min-h-11 shrink-0 items-center rounded-full bg-marigold px-4 text-sm font-semibold text-[#23180a]">
          📷 {dict.u.scanTitle}
        </a>
      </div>
      <p className="mt-1 text-sm text-ink-faint">{dict.u.priceDefault}</p>

      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="surface p-4">
            <div className="flex items-center gap-3">
              {item.image ? (
                <img src={item.image} alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
              ) : (
                <span className="text-4xl">{item.def.emoji}</span>
              )}
              <div className="flex-1">
                <p className="text-lg font-semibold text-ink">{item.hindiName || itemName(item.def, language)}</p>
                <p className="text-sm text-ink-faint">{nativeRupaye(item.sellCents, language)} · 🔴 {nativeRupaye(item.floorCents, language)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StepBtn label="-" onClick={() => set(item.id, item.sellCents - 100, item.floorCents)} />
                <StepBtn label="+" onClick={() => set(item.id, item.sellCents + 100, item.floorCents)} />
              </div>
            </div>
            <input
              type="range"
              min={item.floorCents + 100}
              max={Math.max(item.floorCents + 1000, item.sellCents * 2)}
              step={100}
              value={item.sellCents}
              onChange={(e) => set(item.id, Number(e.target.value), item.floorCents)}
              aria-label={`${itemName(item.def, language)} ${dict.u.priceTitle}`}
              className="mt-3 w-full accent-marigold"
            />
          </div>
        ))}
        {!items.length && (
          <p className="surface p-5 text-center text-ink-faint">
            {dict.u.skip} — <a href="/app/seller/simple/setup" className="text-marigold underline">{dict.u.setup}</a>
          </p>
        )}
      </div>
    </div>
  );
}

function StepBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper-3 text-xl font-semibold text-ink active:scale-95"
    >
      {label}
    </button>
  );
}