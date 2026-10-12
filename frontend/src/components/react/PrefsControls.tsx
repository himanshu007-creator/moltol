import { Moon, Sun } from 'lucide-react';
import { usePrefs } from '@/stores/prefs';
import { LOCALES } from '@/lib/i18n';

/** Theme toggle and language toggle. Icon and label swaps are CSS or store driven, so SSR and hydration agree. */
export default function PrefsControls() {
  const toggleTheme = usePrefs((s) => s.toggleTheme);
  const cycleLocale = usePrefs((s) => s.cycleLocale);
  const locale = usePrefs((s) => s.locale);
  const next = LOCALES.find((l) => l.id !== locale) ?? LOCALES[0]!;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={cycleLocale}
        className="inline-flex min-h-11 items-center rounded-full border border-chalk-strong bg-paper-2 px-4 text-sm font-semibold text-ink transition active:scale-95"
        aria-label={`Change language to ${next.label}`}
        title={`Change language to ${next.label}`}
      >
        {next.native}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        className="grid h-11 w-11 place-items-center rounded-full border border-chalk-strong bg-paper-2 text-ink transition active:scale-95"
        aria-label="Switch light or dark theme"
        title="Switch light or dark theme"
      >
        <Sun className="hidden h-5 w-5 dark:block" aria-hidden="true" />
        <Moon className="block h-5 w-5 dark:hidden" aria-hidden="true" />
      </button>
    </div>
  );
}
