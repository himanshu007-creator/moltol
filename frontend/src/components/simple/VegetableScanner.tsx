import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { s } from '@/lib/simple/strings';
import { speak } from '@/lib/voice';
import { snapInventory, type SnapSuggestion } from '@/lib/backend';
import { BigButton, VoiceCaption, } from './ui';
import ProductCreationForm, { type ProductSuggestion } from './ProductCreationForm';

type Phase = 'camera' | 'suggestions' | 'form';
type CamState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable';

export default function VegetableScanner({ onDone }: { onDone?: () => void }) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const token = useSession((x) => x.token);
  const dict = s(language);

  const [phase, setPhase] = useState<Phase>('camera');
  const [cam, setCam] = useState<CamState>('idle');
  const [snapping, setSnapping] = useState(false);
  const [suggestions, setSuggestions] = useState<SnapSuggestion[]>([]);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ProductSuggestion | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCam('starting');
    try {
      const stream = await withTimeout<MediaStream>(
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
        8000,
      );
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCam('live');
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setCam(denied ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const snap = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !token) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    setSnapping(true);
    setSnapError(null);
    speak(dict.v.scanLead, language, { mute });
    try {
      const res = await snapInventory(token, dataUrl);
      if (res.suggestions.length === 0) {
        setSnapError("Couldn't recognise this photo — try again or enter it manually.");
        return;
      }
      setSuggestions(res.suggestions);
      setPhase('suggestions');
      speak(dict.v.scanFound, language, { mute });
    } catch {
      setSnapError("Couldn't reach the backend — try again.");
    } finally {
      setSnapping(false);
    }
  }, [token, dict.v.scanLead, dict.v.scanFound, language, mute]);

  const pick = (sug: SnapSuggestion) => {
    setChosen({ name: sug.name, emoji: sug.emoji, sellCents: sug.sellCents ?? undefined });
    setPhase('form');
  };

  const manual = () => {
    setChosen(null);
    setPhase('form');
  };

  if (phase === 'form') {
    return (
      <ProductCreationForm
        initial={chosen}
        onBack={() => setPhase('camera')}
        onDone={onDone}
      />
    );
  }

  if (phase === 'suggestions') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
        <h1 className="text-2xl font-semibold text-ink">{dict.u.scanTitle}</h1>
        <p className="mt-1 text-sm text-ink-faint">{dict.u.scanLooks}</p>
        <ul className="mt-4 grid gap-2" aria-label="Suggestions">
          {suggestions.map((sug, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(sug)}
                className="flex min-h-16 w-full items-center gap-3 surface p-4 text-left active:scale-[0.99]"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-paper-3 text-2xl" aria-hidden="true">{sug.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-ink">{sug.name}</span>
                  {sug.sellCents != null && <span className="block text-xs text-ink-faint">suggested ₹{(sug.sellCents / 100).toFixed(0)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPhase('camera')} className="mt-3 text-sm font-medium text-ink-faint underline">
          {dict.u.scanStart}
        </button>
        <button type="button" onClick={manual} className="mt-6 w-full surface p-4 text-lg font-semibold text-ink">
          {dict.u.scanManual} →
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.scanTitle}</h1>
      <p className="mt-1 text-sm text-ink-faint">{dict.u.scanHint}</p>

      <div className="relative mt-4 overflow-hidden rounded-3xl bg-ink/90">
        <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" aria-label={dict.u.scanTitle} />
        <canvas ref={canvasRef} width={640} height={480} className="hidden" />
        <span className="absolute left-3 top-3 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
          {cam === 'live' ? '🎥' : cam === 'starting' ? '…' : '🚫'}
        </span>
      </div>

      <StatusLine cam={cam} snapping={snapping} error={snapError} dict={dict.u} />

      <div className="mt-auto pt-4">
        {cam === 'live' ? (
          <BigButton onClick={() => void snap()} disabled={snapping || !token}>
            {snapping ? dict.u.scanScanning : `📷 ${dict.u.scanStart}`}
          </BigButton>
        ) : (
          <BigButton onClick={manual}>{dict.u.scanManual}</BigButton>
        )}
      </div>

      {(cam === 'denied' || cam === 'unavailable') && (
        <button type="button" onClick={manual} className="mt-3 w-full surface p-4 text-lg font-semibold text-ink">
          {dict.u.scanManual} →
        </button>
      )}
    </div>
  );
}

function StatusLine({
  cam,
  snapping,
  error,
  dict,
}: {
  cam: CamState;
  snapping: boolean;
  error: string | null;
  dict: ReturnType<typeof s>['u'];
}) {
  if (error) return <VoiceCaption voice={error} />;
  let line = '';
  if (cam === 'denied') line = dict.scanPerm;
  else if (cam === 'unavailable' || cam === 'idle') line = dict.scanNoCam;
  else if (snapping) line = dict.scanScanning;
  if (!line) return null;
  return <VoiceCaption voice={line} />;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException('timeout', 'TimeoutError')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
