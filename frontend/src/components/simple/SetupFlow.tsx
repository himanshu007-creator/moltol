import { useEffect, useMemo, useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useSimple } from '@/stores/simple';
import { s, SIMPLE_ITEMS, itemName, nativeNum, nativeRupaye, type ItemId, type Locale } from '@/lib/simple/strings';
import { speakKey, speakRupaye, listen } from '@/lib/voice';
import { BigButton, VoiceCaption, Steps, RoundBtn, AutoSpeak } from './ui';
import { Numpad } from './Numpad';
import PriceRuler from './PriceRuler';

type Step =
  | 'lang' | 'phone' | 'otp' | 'stall'
  | 'products' | 'price' | 'floor' | 'confirm'
  | 'persona' | 'done';

const TOTAL = 6;
const STEP_INDEX: Record<Step, number> = { lang: 0, phone: 1, otp: 1, stall: 2, products: 3, price: 4, floor: 4, confirm: 4, persona: 5, done: 5 };

const EMOJIS = ['🏪', '🛺', '🍉', '🧊', '🌸'];

export default function SetupFlow() {
  const store = useSimple();
  const language = store.language;
  const mute = store.mute;
  const [step, setStep] = useState<Step>('lang');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏪');
  const [picked, setPicked] = useState<ItemId[]>([]);
  const [cursor, setCursor] = useState(0);
  const [sell, setSell] = useState('');
  const [floor, setFloor] = useState(0);
  const [micBusy, setMicBusy] = useState(false);
  const [otpError, setOtpError] = useState(false);

  const stepProducts = useMemo(
    () => picked.filter((id) => id !== 'cust'),
    [picked],
  );
  const current = stepProducts[cursor];
  const dict = s(language);

  useEffect(() => {
    if (step === 'lang') speakKey('lang', language, { mute });
    else if (step === 'phone') speakKey('phone', language, { mute });
    else if (step === 'otp') speakKey('otp', language, { mute });
    else if (step === 'stall') speakKey('stall', language, { mute });
    else if (step === 'products') speakKey('products', language, { mute });
    else if (step === 'price') speakKey('price', language, { mute });
    else if (step === 'floor') speakKey('floor', language, { mute });
    else if (step === 'persona') speakKey('persona', language, { mute });
    else if (step === 'done') speakKey('done', language, { mute });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const goNext = () => {
    window.scrollTo({ top: 0 });
    setStep((p) => STEP_SEQ[STEP_SEQ.indexOf(p) + 1] ?? 'done');
  };
  const goBack = () => {
    setStep((p) => STEP_SEQ[Math.max(0, STEP_SEQ.indexOf(p) - 1)] ?? 'lang');
  };

  const wantMic = async (): Promise<string | null> => {
    setMicBusy(true);
    const res = await listen(language, 6000);
    setMicBusy(false);
    return res;
  };

  const onSellSubmit = () => {
    // sell is a digits string in rupees; floor entered visually — seed a sensible floor
    const sellCents = Number(sell || '0') * 100;
    if (!sellCents) return;
    setFloor(Math.round((sellCents * 0.75) / 100) * 100);
    goNext();
  };

  const onFloorOk = () => {
    const sellCents = Number(sell || '0') * 100;
    if (floor >= sellCents) {
      speakKey('floorBlock', language, { mute });
      return;
    }
    // -> confirm echo for this item
    goNext();
  };

  const confirmItem = (ok: boolean) => {
    if (!current) return;
    store.setPrice(current, Number(sell || '0') * 100, floor);
    if (!ok) {
      // back to price for a re-do
      setStep('price');
      return;
    }
    const nextCursor = cursor + 1;
    if (nextCursor < stepProducts.length) {
      setCursor(nextCursor);
      setSell('');
      setStep('price');
    } else {
      goNext(); // -> persona
    }
  };

  const finish = () => {
    const products = picked
      .filter((id) => id !== 'cust')
      .map((id) => ({ id, sellCents: store.products.find((p) => p.id === id)?.sellCents ?? 0, floorCents: store.products.find((p) => p.id === id)?.floorCents ?? 0 }));
    store.setProducts(products);
    store.setStall(name.trim() || (dict.u.stallPlaceholder.split(':')[0] ?? 'My stall'), emoji);
    store.finishOnboarding();
    // Soft nav: a hard reload can outrun the async IndexedDB write of the
    // onboarding state just saved, and the stall arrives empty.
    void navigate('/app/seller/simple');
  };

  const currentItem = SIMPLE_ITEMS.find((i) => i.id === current);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
      <Steps total={TOTAL} current={STEP_INDEX[step]} />

      {step === 'lang' && (
        <Screen title={dict.u.langTitle} voice="lang">
          <div className="grid gap-3">
            {(['en'] as Locale[]).map((l) => (
              <BigButton key={l} onClick={() => { store.setLanguage(l); speakKey('lang', l, { mute }); setTimeout(goNext, 600); }}>
                English
              </BigButton>
            ))}
          </div>
        </Screen>
      )}

      {step === 'phone' && (
        <Screen title={dict.u.phoneTitle} voice="phone" back={goBack}>
          <Numpad
            value={phone}
            onChange={setPhone}
            max={10}
            contentSlot={
              <div className="mb-2 flex items-center gap-2">
                <RoundBtn icon="🎤" label={dict.u.listen} onClick={async () => {
                  const t = await wantMic();
                  if (t) setPhone(t.replace(/[^\d]/g, ''));
                }} />
                <span className="flex-1 text-xs text-ink-faint">{dict.u.phoneHelp}</span>
              </div>
            }
            onSubmit={
              phone.replace(/[^\d]/g, '').length >= 10
                ? () => { store.setPhone(phone); speakKey('otp', language, { mute }); goNext(); }
                : undefined
            }
          />
          {micBusy && <p className="mt-2 text-center text-sm text-ink-faint">… {dict.u.listen}</p>}
        </Screen>
      )}

      {step === 'otp' && (
        <Screen title={dict.u.otpTitle} voice="otp" back={goBack}>
          <Numpad
            value={otp}
            onChange={(v) => { setOtp(v); setOtpError(false); }}
            max={6}
            contentSlot={<p className="mb-2 surface p-3 text-sm text-ink-faint">{dict.u.otpHint}</p>}
            onSubmit={
              otp.replace(/[^\d]/g, '').length === 6
                ? () => {
                    const ok = otp.replace(/[^\d]/g, '') === '1234';
                    if (!ok) { setOtpError(true); return; }
                    store.verifyPhone();
                    speakKey('stall', language, { mute });
                    goNext();
                  }
                : undefined
            }
          />
          {otpError && <p className="mt-2 text-center text-sm font-medium text-chili">{dict.u.again}</p>}
        </Screen>
      )}

      {step === 'stall' && (
        <Screen title={dict.u.stallTitle} voice="stall" back={goBack}>
          <button
            type="button"
            onClick={async () => {
              const t = await wantMic();
              if (t) setName(t.replace(/[^a-zA-Z\u0900-\u097F\u0A00-\u0A7F ]/g, '').slice(0, 28));
            }}
            className="flex h-16 w-full items-center justify-center gap-2 surface text-lg text-ink"
          >
            🎤 {dict.u.stallAsk}
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={dict.u.stallPlaceholder}
            className="mt-3 w-full surface px-4 py-4 text-lg text-ink placeholder:text-ink-faint"
          />
          <div className="mt-3 grid grid-cols-5 gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={`flex h-14 items-center justify-center rounded-2xl text-2xl ${emoji === e ? 'bg-marigold/30 ring-2 ring-marigold' : 'bg-paper-2'}`}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">{dict.u.photoHint}</p>
          <Bottom><BigButton onClick={goNext}>{dict.u.next}</BigButton></Bottom>
        </Screen>
      )}

      {step === 'products' && (
        <Screen title={dict.u.productTitle} voice="products" back={goBack}>
          <div className="grid grid-cols-2 gap-3">
            {SIMPLE_ITEMS.map((i) => {
              const on = picked.includes(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPicked((p) => (on ? p.filter((x) => x !== i.id) : [...p, i.id]));
                    speak(itemName(i, language), language, { mute });
                  }}
                  className={`flex flex-col items-center gap-1 rounded-3xl p-4 text-center ${on ? 'bg-marigold/25 ring-2 ring-marigold' : 'bg-paper-2'}`}
                >
                  <span className="text-4xl">{i.emoji}</span>
                  <span className="text-sm font-medium text-ink">{itemName(i, language)}</span>
                  {on && <span className="text-lg text-marigold">✓</span>}
                </button>
              );
            })}
          </div>
          <Bottom>
            <BigButton
              onClick={() => {
                if (!picked.length) return;
                setCursor(0);
                setSell('');
                goNext();
              }}
              disabled={!picked.length}
            >
              {dict.u.next} ({nativeNum(picked.length || 0, language)})
            </BigButton>
          </Bottom>
        </Screen>
      )}

      {(step === 'price' || step === 'floor' || step === 'confirm') && current && currentItem && (
        <>
          <div className="my-4 flex items-center gap-3">
            <span className="text-5xl">{currentItem.emoji}</span>
            <div>
              <h1 className="text-2xl font-semibold text-ink">{itemName(currentItem, language)}</h1>
              <p className="text-sm text-ink-faint">{cursor + 1} / {Math.max(1, stepProducts.length)}</p>
            </div>
          </div>

          {step === 'price' && (
            <>
              <VoiceCaption voice={dict.v.price} mute={mute} />
              <Numpad
                value={sell}
                onChange={setSell}
                max={4}
                prefix={<span className="text-3xl leading-none">₹</span>}
                renderValue={(d) => nativeNum(d || '0', language)}
                onSubmit={onSellSubmit}
              />
              <Bottom><BigButton onClick={onSellSubmit} disabled={!Number(sell)}>{dict.u.next}</BigButton></Bottom>
            </>
          )}

          {step === 'floor' && (
            <>
              <VoiceCaption voice={dict.v.floor} mute={mute} />
              <p className="text-sm text-ink-muted">{dict.u.floorHint}</p>
              <PriceRuler
                valueCents={floor}
                sellCents={Number(sell || '0') * 100}
                minCents={100}
                maxCents={Math.max(10000, Number(sell || '0') * 100)}
                onChange={setFloor}
                label={dict.u.floorTitle}
              />
              {floor >= Number(sell || '0') * 100 && (
                <p className="mt-2 text-center text-sm font-medium text-chili">{dict.u.floorBlock}</p>
              )}
              <Bottom><BigButton onClick={onFloorOk} variant="danger">🔴 {dict.u.next}</BigButton></Bottom>
            </>
          )}

          {step === 'confirm' && (
            <>
              <ConfirmEcho
                emoji={currentItem.emoji}
                label={itemName(currentItem, language)}
                sellCents={Number(sell || '0') * 100}
                floorCents={floor}
                yes={() => confirmItem(true)}
                no={() => confirmItem(false)}
                dictYes={dict.u.yes}
                dictNo={dict.u.no}
                confirmTitle={dict.u.confirmTitle}
              />
            </>
          )}
        </>
      )}

      {step === 'persona' && (
        <Screen title={dict.u.personaTitle} voice="persona" back={goBack}>
          <p className="text-sm text-ink-muted">{dict.u.personaHint}</p>
          <div className="mt-3 grid gap-3">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  store.setPersona(p.id);
                  speakKey(p.voiceKey, language, { mute });
                }}
                className={`flex items-center gap-3 rounded-3xl p-4 text-left ${store.persona === p.id ? 'bg-chili/12 ring-2 ring-chili' : 'bg-paper-2'}`}
              >
                <span className="text-3xl">{p.emoji}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-ink">{p.label}</span>
                  <span className="block text-sm text-ink-faint">{p.blurb}</span>
                </span>
                <span className="rounded-full bg-paper-3 px-3 py-1 text-xl" aria-label="sample">🔊</span>
              </button>
            ))}
          </div>
          <Bottom><BigButton onClick={goNext}>{dict.u.next}</BigButton></Bottom>
        </Screen>
      )}

      {step === 'done' && (
        <Screen title={dict.u.doneTitle} voice="done">
          <p className="text-center text-6xl">{emoji}</p>
          <p className="mt-2 text-center text-xl font-semibold text-ink">{name.trim() || dict.u.stallPlaceholder}</p>
          <p className="mt-1 text-center text-sm text-ink-muted">{dict.u.doneSub}</p>
          <Bottom>
            <BigButton onClick={finish}>{dict.u.start ?? '🪔 ' + dict.u.doneTitle}</BigButton>
          </Bottom>
        </Screen>
      )}
    </div>
  );
}

function speak(text: string, language: Locale, opts: { mute?: boolean }) {
  import('@/lib/voice').then((v) => v.speak(text, language, opts));
}

const STEP_SEQ: Step[] = ['lang', 'phone', 'otp', 'stall', 'products', 'price', 'floor', 'confirm', 'persona', 'done'];

const PERSONAS = [
  { id: 'charmer' as const, emoji: '😊', label: 'Charmer', blurb: 'Smile, talk, win', voiceKey: 'personaCharmer' },
  { id: 'stoic' as const, emoji: '😐', label: 'Stoic', blurb: 'Rock solid price', voiceKey: 'personaStoic' },
  { id: 'storyteller' as const, emoji: '🗣️', label: 'Storyteller', blurb: 'The bazaar is a stage', voiceKey: 'personaStoryteller' },
];

function Screen({ title, voice, back, children }: { title: string; voice: string; back?: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {back && (
        <button type="button" onClick={back} className="w-fit text-sm font-medium text-ink-faint hover:text-ink">
          ← {BACK_ARROW_LABEL}
        </button>
      )}
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <AutoSpeak keyName={voice} />
      {children}
    </div>
  );
}

const BACK_ARROW_LABEL = 'Back';

function Bottom({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto pt-4">{children}</div>;
}

function ConfirmEcho({ emoji, label, sellCents, floorCents, yes, no, dictYes, dictNo, confirmTitle }: {
  emoji: string; label: string; sellCents: number; floorCents: number; yes: () => void; no: () => void; dictYes: string; dictNo: string; confirmTitle: string;
}) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  speakRupaye(sellCents, language, { mute });
  return (
    <div className="flex flex-col gap-4">
      <VoiceCaption voice={`${label}. ${dictYes}?`} mute={mute} />
      <div className="flex items-center justify-center gap-3 surface p-5">
        <span className="text-5xl">{emoji}</span>
        <div className="text-center">
          <p className="text-2xl font-bold text-marigold">{nativeRupaye(sellCents, language)}</p>
          <p className="text-lg font-semibold text-chili">{nativeRupaye(floorCents, language)} 🔴</p>
        </div>
      </div>
      <p className="text-center text-2xl font-semibold text-ink">{confirmTitle}</p>
      <div className="grid grid-cols-2 gap-3">
        <BigButton onClick={no} variant="danger">{dictNo} ✖️</BigButton>
        <BigButton onClick={yes}>{dictYes} ✔️</BigButton>
      </div>
    </div>
  );
}