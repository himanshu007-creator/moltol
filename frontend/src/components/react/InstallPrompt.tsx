import { useEffect, useState } from 'react';

/** Not yet in lib.dom.d.ts — Chrome/Edge/Android only. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'moltol-install-dismissed';

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/**
 * A one-time "install this app" banner. Chrome/Edge/Android get the real
 * `beforeinstallprompt` flow; iOS Safari has no such API, so it gets a plain
 * "Share → Add to Home Screen" instruction instead. Silent once dismissed,
 * and never shown at all once actually running standalone.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    if (isIos()) {
      setShowIosHint(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
    setShowIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  if (!deferred && !showIosHint) return null;

  return (
    <div className="rise fixed inset-x-4 bottom-4 z-40 sm:inset-x-auto sm:right-4 sm:w-96" role="status">
      <div className="surface flex items-center gap-3 p-4">
        <img src="/icon-192.png" alt="" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-ink">Install MolTol</p>
          <p className="text-ink-muted">
            {showIosHint ? 'Tap Share, then "Add to Home Screen".' : 'Add it to your home screen for the full app, one tap away.'}
          </p>
        </div>
        {!showIosHint && (
          <button type="button" onClick={() => void install()} className="btn btn-primary !min-h-9 shrink-0 !px-3 !text-xs">
            Install
          </button>
        )}
        <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className="shrink-0 rounded-full p-1.5 text-ink-faint hover:text-ink">
          ✕
        </button>
      </div>
    </div>
  );
}
