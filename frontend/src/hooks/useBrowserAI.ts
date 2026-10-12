import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper over Chrome's built-in Prompt API (`window.LanguageModel`).
 *
 * Everything here runs on-device: model download (when needed), the multimodal
 * prompt, and inference. No network call, key, or third-party library is used.
 * The API is desktop-Chrome-only today, so `status` is the source of truth and
 * callers MUST always render a manual fallback when it is not `ready`.
 */

export type AIStatus =
  | 'checking'
  | 'unsupported'
  | 'downloadable'
  | 'downloading'
  | 'ready'
  | 'error';

export interface AIProgress {
  loaded: number;
  total: number;
}

const CREATE_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export interface BrowserAI {
  status: AIStatus;
  progress: AIProgress | null;
  /** true while a single inference is in flight — the loop must skip when set */
  busy: () => boolean;
  /** create the session on a user gesture (downloads on first use) */
  ensureSession: () => Promise<LanguageModelSession | null>;
  /** run one guarded inference; resolves null when unavailable or busy */
  prompt: (input: LanguageModelMessage[]) => Promise<string | null>;
}

export function useBrowserAI(): BrowserAI {
  const [status, setStatus] = useState<AIStatus>('checking');
  const [progress, setProgress] = useState<AIProgress | null>(null);

  const sessionRef = useRef<LanguageModelSession | null>(null);
  const creatingRef = useRef<Promise<LanguageModelSession | null> | null>(null);
  const busyRef = useRef(false);
  const destroyedRef = useRef(false);

  useEffect(() => {
    destroyedRef.current = false;
    let cancelled = false;
    const api = typeof window !== 'undefined' ? window.LanguageModel : undefined;
    if (!api) {
      setStatus('unsupported');
      return () => {
        cancelled = true;
      };
    }
    api
      .availability(CREATE_OPTIONS)
      .then((availability) => {
        if (cancelled) return;
        if (availability === 'available') setStatus('ready');
        else if (availability === 'downloading') setStatus('downloading');
        else if (availability === 'downloadable') setStatus('downloadable');
        else setStatus('unsupported');
      })
      .catch(() => {
        if (!cancelled) setStatus('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureSession = useCallback(async (): Promise<LanguageModelSession | null> => {
    if (sessionRef.current) return sessionRef.current;
    const api = typeof window !== 'undefined' ? window.LanguageModel : undefined;
    if (!api) {
      setStatus('unsupported');
      return null;
    }
    if (creatingRef.current) return creatingRef.current;

    const create = api
      .create({
        ...CREATE_OPTIONS,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            setStatus('downloading');
            setProgress({ loaded: event.loaded, total: event.total });
          });
        },
      })
      .then((session) => {
        if (destroyedRef.current) {
          session.destroy();
          return null;
        }
        sessionRef.current = session;
        setProgress(null);
        setStatus('ready');
        return session;
      })
      .catch(() => {
        setStatus('error');
        return null;
      })
      .finally(() => {
        creatingRef.current = null;
      });

    creatingRef.current = create;
    return create;
  }, []);

  const prompt = useCallback(
    async (input: LanguageModelMessage[]): Promise<string | null> => {
      if (busyRef.current) return null;
      const session = sessionRef.current ?? (await ensureSession());
      if (!session) return null;
      busyRef.current = true;
      try {
        return await session.prompt(input);
      } catch {
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [ensureSession],
  );

  useEffect(
    () => () => {
      destroyedRef.current = true;
      try {
        sessionRef.current?.destroy();
      } catch {
        /* noop */
      }
      sessionRef.current = null;
    },
    [],
  );

  return { status, progress, busy: () => busyRef.current, ensureSession, prompt };
}
