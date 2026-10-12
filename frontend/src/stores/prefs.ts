import { create } from 'zustand';
import { applyI18n, LOCALES, t as translate, type Locale } from '@/lib/i18n';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'moltol-theme';
const LOCALE_KEY = 'moltol-locale';

function readTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

function readLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'en';
  const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
  return stored && LOCALES.some((l) => l.id === stored) ? stored : 'en';
}

interface PrefsStore {
  theme: Theme;
  locale: Locale;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLocale: (locale: Locale) => void;
  cycleLocale: () => void;
  sync: () => void;
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

function applyLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  applyI18n(document, locale);
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  theme: 'light',
  locale: 'en',
  setTheme: (theme) => {
    applyTheme(theme);
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setLocale: (locale) => {
    applyLocale(locale);
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, locale);
    set({ locale });
  },
  cycleLocale: () => {
    const i = LOCALES.findIndex((l) => l.id === get().locale);
    const next = LOCALES[(i + 1) % LOCALES.length]?.id ?? 'en';
    get().setLocale(next);
  },
  /** Read persisted prefs and apply them. Called once from Base.astro. */
  sync: () => {
    const theme = readTheme();
    const locale = readLocale();
    applyTheme(theme);
    applyLocale(locale);
    set({ theme, locale });
  },
}));

/** Bind the current locale to a translator for React islands. */
export function useI18n() {
  const locale = usePrefs((s) => s.locale);
  return {
    locale,
    t: (key: string) => translate(locale, key),
  };
}
