/**
 * Simple Mode voice layer. Everything is "speak the key line, always show the
 * caption" — sound is an enhancement, never the only channel.
 *
 * Voice: Web Speech API TTS (hi-IN / pa-IN / en-IN). Optionally swap in
 * pre-recorded audio by setting PUBLIC_SIMPLE_AUDIO=true and filling a {key: url}
 * manifest (keeps lab environments reproducible).
 *
 * Listening: Web Speech API SpeechRecognition, one-shot with a timeout.
 * Mic is never active unless a screen taps "listen". Every step has a tap
 * fallback, so a refused mic never blocks the flow.
 */

import type { Locale } from '@/lib/simple/strings';
import { rupayeWords, s } from '@/lib/simple/strings';

export function speechLang(_locale?: Locale): string {
  return 'en-IN';
}

export const speechSynthesisOk =
  typeof window !== 'undefined' && 'speechSynthesis' in window;

const hasRecognition =
  typeof window !== 'undefined' &&
  (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window));

export function listenOk(): boolean {
  return hasRecognition;
}

type NakedW = {
  lang?: string;
  name?: string;
};

function pickVoice(lang: string): NakedW | undefined {
  try {
    const voices = speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === lang && /google|female|male/i.test(v.name)) ??
      voices.find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()) ??
      voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang.split('-')[0]!.toLowerCase()))
    );
  } catch {
    return undefined;
  }
}

/** Lazily persist the voice list — Chrome populates it async. */
if (speechSynthesisOk) {
  speechSynthesis.onvoiceschanged = () => {
    pickVoice('hi-IN');
  };
}

/**
 * Speak raw text in the target language voice. Returns false if TTS is off.
 * Cancels any ongoing utterance so only one line plays at a time.
 */
export function speak(
  text: string,
  locale: Locale,
  opts: { mute?: boolean; rate?: number } = {},
): boolean {
  if (opts.mute || !speechSynthesisOk || !text) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const lang = speechLang(locale);
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v as SpeechSynthesisVoice;
    u.rate = opts.rate ?? 0.95;
    u.pitch = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  if (speechSynthesisOk) {
    try {
      speechSynthesis.cancel();
    } catch {
      /* noop */
    }
  }
}

/** Say one of the strings.v keyed lines (translated). */
export function speakKey(key: string, locale: Locale, opts?: { mute?: boolean }): boolean {
  const line = s(locale).v[key];
  if (!line) return false;
  return speak(line, locale, opts);
}

/** Say a money amount, e.g. "fifty rupees". */
export function speakRupaye(cents: number, locale: Locale, opts?: { mute?: boolean }): boolean {
  return speak(rupayeWords(cents, locale), locale, opts);
}

/**
 * One-shot listen. Resolves the transcript (trimmed) or null on timeout /
 * denial / unsupported. Never throws; the caller always offers tap fallback.
 */
export function listen(locale: Locale, timeoutMs = 6000): Promise<string | null> {
  if (!listenOk()) return Promise.resolve(null);
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SRW }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SRW }).webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve(null);

  const rec = new Ctor();
  rec.lang = speechLang(locale);
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        rec.stop();
      } catch {
        /* noop */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    rec.onresult = (e: SRWEvent) => {
      const t = e.results?.[0]?.[0]?.transcript?.trim();
      finish(t || null);
    };
    rec.onerror = () => finish(null);
    rec.onend = () => finish(null);
    try {
      rec.start();
    } catch {
      finish(null);
    }
  });
}

interface SRW {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SRWEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SRWEvent {
  results?: Array<Array<{ transcript?: string }>>;
}

/** Extract a number from a spoken phrase ("50 rupay", "fifty rupees"). */
export function parseSpokenMoney(phrase: string | null, locale: Locale): number | null {
  if (!phrase) return null;
  const words = phrase.toLowerCase().trim();

  const digits = words.replace(/[^\d]/g, '');
  if (/^\d{1,3}(\.\d+)?$/.test(digits)) return Math.round(Number(digits)) * 100;

  const currencyIn = (text: string): number => Math.round(Number(text.replace(/[^\d.]/g, '')) || 0);

  for (const re of [
    /\b(\d{1,3}(?:\.\d+)?)\s*(?:rupay(?:a)?|rupee|rupees|₹)/i,
    /\b(?:rupay|rupee|₹)\s*(\d{1,3}(?:\.\d+)?)/i,
  ]) {
    const m = words.match(re);
    if (m) return currencyIn(m[1]!) * 100;
  }

  return digitWordsToCents(words, locale);
}

function digitWordsToCents(words: string, _locale?: Locale): number | null {
  const wordMap: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  };

  const tokens = words.split(/[\s-]+/).filter((t) => wordMap[t] !== undefined);
  if (!tokens.length) return null;
  let total = 0;
  let acc = 0;
  for (const t of tokens) {
    const v = wordMap[t]!;
    if (v === 100 || v === 1000) {
      acc = (acc || 1) * v;
      total += acc;
      acc = 0;
    } else {
      acc += v;
    }
  }
  total += acc;
  if (total <= 0) return null;
  return total * 100;
}