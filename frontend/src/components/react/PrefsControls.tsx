import { Moon, Sun } from 'lucide-react';
import { usePrefs } from '@/stores/prefs';

/** Theme toggle. Icon swap is CSS driven, so SSR and hydration agree. */
export default function PrefsControls() {
  const toggleTheme = usePrefs((s) => s.toggleTheme);
  return (
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
  );
}
