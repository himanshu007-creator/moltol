import { useMemo, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { type Locale, s, nativeRupaye, nativeNum, numToWords } from '@/lib/simple/strings';
import { speakRupaye } from '@/lib/voice';
import { playVoice } from '@/lib/voiceClips';
import { BigButton, } from './ui';
import CoinDrop from '@/components/motion/CoinDrop';
import { SIMPLE_ITEMS } from '@/lib/simple/strings';

export default function SimpleHaggle() {
  const store = useSimple();
  const { haggle, language, mute } = store;
  const dict = s(language);
  const [counter, setCounter] = useState('');

  const offerItems = useMemo(
    () =>
      store.products.length
        ? store.products
        : SIMPLE_ITEMS.slice(0, 3).map((i) => ({ id: i.id, sellCents: 4000, floorCents: 2500 })),
    [store.products],
  );

  const simulate = () => {
    const p = offerItems[Math.floor(Math.random() * offerItems.length)];
    if (!p) return;
    const base = p.sellCents;
    const offer = Math.round(((base * (0.66 + Math.random() * 0.12)) / 100)) * 100;
    const item = SIMPLE_ITEMS.find((i) => i.id === p.id);
    store.setHaggle({
      step: 'offer',
      offerCents: offer,
      lastOutcome: null,
      dealCents: null,
      offerItem: item?.en ?? p.id,
      offerEmoji: item?.emoji ?? '🛒',
    });
    playVoice('offer.new');
  };

  const accept = () => {
    if (haggle.offerCents == null) return;
    store.acceptDeal(haggle.offerCents, haggle.offerItem, haggle.offerEmoji);
    playVoice('money.credited', { amount: Math.round(haggle.offerCents / 100) });
  };

  const refuse = () => {
    store.setHaggle({ step: 'waiting', offerCents: null, lastOutcome: 'refused' });
  };

  const sendCounter = () => {
    const c = Number(counter || '0') * 100;
    if (!c) return;
    store.setHaggle({ step: 'waiting', offerCents: null, lastOutcome: null });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
      {haggle.step === 'done' && haggle.lastOutcome === 'accepted' && <CoinDrop key={String(haggle.dealCents)} />}

      {haggle.step === 'offer' && haggle.offerCents != null && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <span className="text-6xl">{haggle.offerEmoji}</span>
          <p className="text-2xl font-semibold text-ink">
            {haggle.offerItem} · {dict.u.haggleOffer}
          </p>
          <div className="rounded-[2.5rem] bg-paper-2 px-8 py-8 shadow-[0_20px_60px_-30px_rgba(206,64,54,0.5)] ring-8 ring-chili/10">
            <p className="text-7xl font-bold tracking-tight text-ink">{nativeRupaye(haggle.offerCents, language)}</p>
            <p className="mt-2 text-sm text-ink-faint">{numToWords(haggle.offerCents / 100, language)}</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            <BigButton onClick={refuse} variant="danger">❌ {dict.u.haggleRefuse}</BigButton>
            <BigButton onClick={accept}>✅ {dict.u.haggleAccept}</BigButton>
          </div>
          <BigButton onClick={() => { setCounter(''); store.setHaggle({ step: 'counter' }); }} variant="ghost">
            🎤 {dict.u.haggleCounter}
          </BigButton>
        </div>
      )}

      {haggle.step === 'counter' && (
        <div className="flex flex-1 flex-col gap-4">
          <h1 className="text-2xl font-semibold text-ink">{dict.u.haggleCounter}</h1>
          <div className="flex items-stretch gap-2">
            {[5, 10, 20].map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setCounter(String(x))}
                className="flex-1 surface p-3 text-lg font-semibold text-ink"
              >
                +{nativeRupaye(x * 100, language)}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <PricePad value={counter} onChange={setCounter} mute={mute} language={language} />
          </div>
          <div className="mt-auto pt-4">
            <BigButton onClick={sendCounter} disabled={!Number(counter)}>➤ {dict.u.save}</BigButton>
          </div>
        </div>
      )}

      {haggle.step === 'done' && haggle.dealCents != null && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-paper text-center">
          <div className="rounded-full bg-teal/15 p-8 text-7xl">🤝</div>
          <p className="text-3xl font-bold text-teal">{dict.u.dealAmount}</p>
          <p className="text-8xl font-black text-ink">{nativeRupaye(haggle.dealCents, language)}</p>
          <p className="mt-2 text-teal">+{dict.u.homeEarnings}</p>
          <div className="mt-auto w-full space-y-3">
            <BigButton onClick={simulate}>{dict.u.homeNew}</BigButton>
            <BigButton onClick={simulate} variant="ghost">🔁 {dict.u.again}</BigButton>
          </div>
        </div>
      )}

      {(haggle.step === 'idle' || haggle.step === 'waiting') && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <span className="text-7xl animate-pulse-soft">🛒</span>
          <p className="text-xl text-ink-muted">
            {haggle.lastOutcome === 'refused' ? dict.u.dealNo : dict.u.haggleWaiting}
          </p>
          <button
            type="button"
            onClick={simulate}
            className="w-full rounded-3xl bg-chili/10 p-5 text-lg font-semibold text-chili"
          >
            🎭 {dict.u.sim}
          </button>
        </div>
      )}
    </div>
  );
}

function PricePad({ value, onChange, mute, language }: { value: string; onChange: (v: string) => void; mute: boolean; language: Locale }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫', '✓'];
  const handle = (k: string) => {
    if (k === '⌫') onChange(value.slice(0, -1));
    else if (k === '✓') speakRupaye(Number(value || '0') * 100, language, { mute });
    else onChange((value + k).slice(0, 4));
  };
  return (
    <div className="grid grid-cols-3 gap-3">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => handle(k)} aria-label={k}
          className={`h-16 rounded-2xl text-xl font-semibold ${/^\d+$/.test(k) ? 'bg-paper-2 text-ink' : 'bg-paper-3 text-ink-muted'} active:scale-95`}>
          {/^\d/.test(k) ? nativeNum(k, language) : k}
        </button>
      ))}
    </div>
  );
}