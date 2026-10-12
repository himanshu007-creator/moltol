import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimple } from '@/stores/simple';
import { s } from '@/lib/simple/strings';
import { speak } from '@/lib/voice';
import { VEG_CATALOG, allowedKeys, parseVegGuess, vegName, type VegSpec } from '@/lib/vision/catalog';
import { useBrowserAI } from '@/hooks/useBrowserAI';
import { BigButton, VoiceCaption, } from './ui';
import ProductCreationForm from './ProductCreationForm';

type Phase = 'scan' | 'review' | 'manual' | 'form';
type CamState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable';

const SAMPLE_MS = 1500;
const NEEDED_HITS = 2;

const PROMPT = `You look at a photo of ONE vegetable from an Indian market.
Answer with ONLY a JSON object, no prose, no markdown:
{"name":"<key>","hindiName":"<hindi>"}
Pick <key> from this exact list: ${allowedKeys().join(', ')}.
If it is not one of these, answer {"name":"unknown","hindiName":""}.`;

export default function VegetableScanner({ onDone }: { onDone?: () => void }) {
  const language = useSimple((x) => x.language);
  const mute = useSimple((x) => x.mute);
  const dict = s(language);

  const ai = useBrowserAI();
  const aiStatus = ai.status;

  // Chrome's on-device model (window.LanguageModel) is experimental and, even
  // when "available", can hang in 'downloading'/'downloadable' indefinitely on
  // a given machine — there is no reliable signal to time that out. So the
  // manual picker (same real vegetables, no wait) is the default landing
  // phase; camera scanning is an opt-in extra for browsers where it works,
  // never a gate the buyer can get stuck behind.
  const [phase, setPhase] = useState<Phase>('manual');
  const [cam, setCam] = useState<CamState>('idle');
  const [searching, setSearching] = useState(false);
  const [candidate, setCandidate] = useState<VegSpec | null>(null);
  const [manualPick, setManualPick] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<LanguageModelSession | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const hitsRef = useRef(0);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);

  const stopLoop = useCallback(() => {
    if (loopRef.current != null) {
      clearTimeout(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const recognize = useCallback(async (): Promise<VegSpec | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const text = await ai.prompt([
      {
        role: 'user',
        content: [
          { type: 'text', value: PROMPT },
          { type: 'image', value: canvas },
        ],
      },
    ]);
    return text ? parseVegGuess(text) : null;
  }, [ai]);

  const runLoop = useCallback(() => {
    stopLoop();
    loopRef.current = window.setTimeout(async () => {
      if (!activeRef.current) return;
      try {
        if (!pausedRef.current && !ai.busy()) {
          const guess = await recognize();
          if (guess) {
            if (guess.key === lastKeyRef.current) hitsRef.current += 1;
            else {
              lastKeyRef.current = guess.key;
              hitsRef.current = 1;
            }
            if (hitsRef.current >= NEEDED_HITS) {
              pausedRef.current = true;
              setCandidate(guess);
              setPhase('review');
              speak(`${vegName(guess, language)}. ${dict.v.scanFound}`, language, { mute });
              return;
            }
          }
        }
      } catch {
        /* keep scanning */
      }
      runLoop();
    }, SAMPLE_MS);
  }, [ai, dict.v.scanFound, language, mute, recognize, stopLoop]);

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
    activeRef.current = true;
    if (aiStatus !== 'unsupported') void startCamera();
    return () => {
      activeRef.current = false;
      stopLoop();
      stopCamera();
    };
    // only once on mount / if support resolves late
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiStatus, startCamera, stopCamera, stopLoop]);

  const startScan = useCallback(async () => {
    const session = await ai.ensureSession();
    if (!session) {
      setManualPick(true);
      setPhase('manual');
      return;
    }
    sessionRef.current = session;
    lastKeyRef.current = null;
    hitsRef.current = 0;
    pausedRef.current = false;
    setSearching(true);
    speak(dict.v.scanLead, language, { mute });
    runLoop();
  }, [ai, dict.v.scanLead, language, mute, runLoop]);

  const rescan = useCallback(() => {
    pausedRef.current = false;
    lastKeyRef.current = null;
    hitsRef.current = 0;
    setCandidate(null);
    setSearching(false);
    setPhase('scan');
  }, []);

  const pickManual = useCallback(
    (veg: VegSpec) => {
      pausedRef.current = true;
      setCandidate(veg);
      setPhase('form');
      speak(vegName(veg, language), language, { mute });
    },
    [language, mute],
  );

  if (phase === 'form') {
    return (
      <ProductCreationForm
        initialVeg={candidate}
        onBack={() => {
          setPhase(manualPick ? 'manual' : 'scan');
          if (!manualPick) rescan();
        }}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.scanTitle}</h1>
      <p className="mt-1 text-sm text-ink-faint">{dict.u.scanHint}</p>

      {phase === 'manual' ? (
        <ManualPicker dict={dict.u} onPick={pickManual} onScan={aiStatus === 'ready' ? rescan : undefined} />
      ) : (
        <>
          <div className="relative mt-4 overflow-hidden rounded-3xl bg-ink/90">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-[4/3] w-full object-cover"
              aria-label={dict.u.scanTitle}
            />
            <canvas ref={canvasRef} width={640} height={480} className="hidden" />
            <span className="absolute left-3 top-3 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
              {cam === 'live' ? '🎥' : cam === 'starting' ? '…' : '🚫'}
            </span>
          </div>

          {phase === 'review' && candidate ? (
            <ReviewCard
              veg={candidate}
              dict={dict.u}
              onYes={() => setPhase('form')}
              onNo={() => {
                setManualPick(true);
                setPhase('manual');
              }}
              onRescan={rescan}
            />
          ) : (
            <>
              <StatusLine cam={cam} aiStatus={aiStatus} searching={searching} dict={dict.u} progress={ai.progress} />
              <div className="mt-auto pt-4">
                {cam === 'live' || cam === 'starting' ? (
                  <BigButton onClick={startScan} disabled={cam !== 'live' || aiStatus === 'checking'}>
                    {searching ? `${dict.u.scanScanning}` : aiStatus === 'downloading' ? dict.u.scanModel : `📷 ${dict.u.scanStart}`}
                  </BigButton>
                ) : (
                  <BigButton onClick={() => setPhase('manual')}>{dict.u.scanManual}</BigButton>
                )}

              </div>
            </>
          )}

          {(cam === 'denied' || cam === 'unavailable' || aiStatus === 'unsupported' || aiStatus === 'error') && (
            <button
              type="button"
              onClick={() => setPhase('manual')}
              className="mt-3 w-full surface p-4 text-lg font-semibold text-ink"
            >
              {dict.u.scanManual} →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function StatusLine({
  cam,
  aiStatus,
  searching,
  dict,
  progress,
}: {
  cam: CamState;
  aiStatus: string;
  searching: boolean;
  dict: ReturnType<typeof s>['u'];
  progress: { loaded: number; total: number } | null;
}) {
  const pct = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : null;
  let line = '';
  if (cam === 'denied') line = dict.scanPerm;
  else if (cam === 'unavailable' || cam === 'idle') line = dict.scanNoCam;
  else if (aiStatus === 'unsupported') line = dict.scanUnsupported;
  else if (aiStatus === 'error') line = dict.scanError;
  else if (aiStatus === 'downloading' && pct != null) line = `${dict.scanModel} ${pct}%`;
  else if (aiStatus === 'downloadable') line = dict.scanModel;
  else if (searching) line = dict.scanScanning;
  if (!line) return null;
  return <VoiceCaption voice={line} />;
}

function ReviewCard({
  veg,
  dict,
  onYes,
  onNo,
  onRescan,
}: {
  veg: VegSpec;
  dict: ReturnType<typeof s>['u'];
  onYes: () => void;
  onNo: () => void;
  onRescan: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center gap-4 surface p-5">
        <img src={veg.image} alt="" width={72} height={72} className="h-16 w-16 rounded-2xl" />
        <div className="flex-1">
          <p className="text-sm text-ink-faint">{dict.scanLooks}</p>
          <p className="text-2xl font-semibold text-ink">{veg.emoji} {veg.en}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <BigButton variant="danger" onClick={onNo}>{dict.scanWrong}</BigButton>
        <BigButton onClick={onYes}>{dict.scanConfirm} ✔️</BigButton>
      </div>
      <button type="button" onClick={onRescan} className="text-sm font-medium text-ink-faint underline">
        {dict.scanStart}
      </button>
    </div>
  );
}

function ManualPicker({
  dict,
  onPick,
  onScan,
}: {
  dict: ReturnType<typeof s>['u'];
  onPick: (veg: VegSpec) => void;
  onScan?: () => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-3 surface p-4 text-sm text-ink-faint">{dict.scanManual}</p>
      {onScan && (
        <button type="button" onClick={onScan} className="mb-3 text-sm font-medium text-marigold underline">
          📷 {dict.scanStart}
        </button>
      )}
      <div className="grid grid-cols-3 gap-3">
        {VEG_CATALOG.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onPick(v)}
            className="flex flex-col items-center gap-1 surface p-3 text-center active:scale-95"
          >
<img src={v.image} alt="" width={56} height={56} className="h-14 w-14 rounded-xl" />
            <span className="text-xs font-medium text-ink">{v.en}</span>
          </button>
        ))}
      </div>
    </div>
  );
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
