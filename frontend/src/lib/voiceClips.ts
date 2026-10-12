/**
 * Plays the pre-generated Cartesia clips in order, back to back, through one
 * Web Audio queue. Falls back to the browser's speech for the whole line if a
 * clip is missing or offline. Respects the single mute switch in the Simple store.
 * Browsers only allow audio after a tap, so money lines before the first tap show
 * a toast with a "tap to hear" action instead.
 */
import { clipPlan, CLIP_TEXT, numberClipText, VOICE_LINES, type VoiceLocale } from '@/lib/copy/voice';
import { useSimple } from '@/stores/simple';
import { useUi } from '@/stores/ui';

let ctx: AudioContext | null = null;
const cache = new Map<string, Promise<AudioBuffer | null>>();
let unlocked = false;
let pending: { line: keyof typeof VOICE_LINES; vars: Record<string, number> } | null = null;
const OVERLAP_S = 0.04;

const locale = (): VoiceLocale => (typeof document !== 'undefined' && document.documentElement.lang === 'hi' ? 'hi' : 'en');

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

async function clip(loc: VoiceLocale, key: string): Promise<AudioBuffer | null> {
  const id = `${loc}/${key}`;
  if (!cache.has(id)) {
    cache.set(
      id,
      (async () => {
        try {
          const res = await fetch(`/voice/${loc}/${key}.mp3`);
          if (!res.ok) return null;
          const a = audio();
          return a ? await a.decodeAudioData(await res.arrayBuffer()) : null;
        } catch {
          return null;
        }
      })(),
    );
  }
  return cache.get(id)!;
}

/** Plain-text version of a line, for the speech fallback. */
function lineText(line: keyof typeof VOICE_LINES, loc: VoiceLocale, vars: Record<string, number>): string {
  const nums = numberClipText(loc);
  const words: string[] = [];
  for (const key of clipPlan(line, loc, vars)) {
    words.push(key.startsWith('n.') ? nums[key]! : CLIP_TEXT[loc][key] ?? key);
  }
  return words.join(' ');
}

function speechFallback(text: string, loc: VoiceLocale) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = loc === 'hi' ? 'hi-IN' : 'en-IN';
  window.speechSynthesis.speak(u);
}

/** Schedule the clips back to back so the sentence sounds like one take. */
async function run(line: keyof typeof VOICE_LINES, loc: VoiceLocale, vars: Record<string, number>) {
  const a = audio();
  const keys = clipPlan(line, loc, vars);
  const buffers = await Promise.all(keys.map((k) => clip(loc, k)));
  if (!a || buffers.some((b) => !b)) {
    speechFallback(lineText(line, loc, vars), loc);
    return;
  }
  let t = a.currentTime + 0.05;
  for (const b of buffers) {
    const src = a.createBufferSource();
    src.buffer = b!;
    src.connect(a.destination);
    src.start(t);
    t += b!.duration - OVERLAP_S;
  }
}

/** Play a line. Silent when voice is muted. */
export function playVoice(line: keyof typeof VOICE_LINES, vars: Record<string, number> = {}) {
  if (useSimple.getState().mute) return;
  const loc = locale();
  const a = audio();
  if (!unlocked || (a && a.state === 'suspended')) {
    pending = { line, vars };
    useUi.getState().push(`${lineText(line, loc, vars)}. Tap to hear`);
    return;
  }
  void run(line, loc, vars);
}

/** Call from the first user gesture. Plays any line that was waiting for it. */
export function unlockVoice() {
  if (unlocked) return;
  const a = audio();
  if (!a) return;
  void a.resume().then(() => {
    unlocked = true;
    if (pending) {
      const p = pending;
      pending = null;
      void run(p.line, locale(), p.vars);
    }
  });
}

if (typeof window !== 'undefined') {
  const onGesture = () => {
    unlockVoice();
    window.removeEventListener('pointerdown', onGesture);
  };
  window.addEventListener('pointerdown', onGesture, { once: false });
}
