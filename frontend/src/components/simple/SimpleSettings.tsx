import { navigate } from 'astro:transitions/client';
import { useSimple } from '@/stores/simple';
import { useSession } from '@/stores/session';
import { s } from '@/lib/simple/strings';
import { ROUTES } from '@/lib/routes';

export default function SimpleSettings() {
  const { language, mute, toggleMute, reset } = useSimple();
  const setSellerMode = useSession((st) => st.setSellerMode);
  const setRole = useSession((st) => st.setRole);
  const dict = s(language);

  const rows = [
    {
      label: dict.u.sound,
      sub: dict.u.soundOn,
      active: !mute,
      on: () => !mute && toggleMute(),
      off: () => mute && toggleMute(),
    },
  ];

  const switchToModern = () => {
    setSellerMode('modern');
    setRole('seller', ROUTES.seller.inventory);
    void navigate(ROUTES.seller.inventory);
  };

  const restartSetup = () => {
    reset();
    void navigate(ROUTES.simple.setup);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold text-ink">{dict.u.settingsTitle}</h1>

      <div className="mt-4 grid gap-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 surface p-4">
            <div className="flex-1">
              <p className="text-base font-semibold text-ink">{r.label}</p>
              <p className="text-xs text-ink-faint">{r.sub}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={r.active}
              aria-label={r.label}
              onClick={() => (r.active ? r.off() : r.on())}
              className={`relative flex h-11 w-16 items-center rounded-full transition ${r.active ? 'bg-marigold' : 'bg-paper-3'}`}
            >
              <span
                className={`absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-paper shadow transition-all ${r.active ? 'left-8' : 'left-1'}`}
              />
            </button>
          </div>
        ))}

        <button type="button" onClick={switchToModern} className="surface flex items-center gap-3 p-4 text-left transition active:scale-[0.99]">
          <div className="flex-1">
            <p className="text-base font-semibold text-ink">{dict.u.modernMode}</p>
            <p className="text-xs text-ink-faint">{dict.u.modernModeHint}</p>
          </div>
          <span className="text-indigo" aria-hidden="true">→</span>
        </button>
      </div>

      <button
        type="button"
        onClick={restartSetup}
        className="mt-10 w-full rounded-3xl bg-chili/10 p-4 text-sm font-semibold text-chili"
      >
        ↺ {dict.u.restartSetup}
      </button>
    </div>
  );
}
