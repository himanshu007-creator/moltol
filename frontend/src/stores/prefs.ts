import { create } from 'zustand';
import { applyI18n, t as translate } from '@/lib/i18n';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'moltol-theme';

function readTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

interface PrefsStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  sync: () => void;
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  theme: 'light',
  setTheme: (theme) => {
    applyTheme(theme);
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  /** Read persisted prefs and apply them. Called once from Base.astro. */
  sync: () => {
    const theme = readTheme();
    applyTheme(theme);
    if (typeof document !== 'undefined') applyI18n(document);
    set({ theme });
  },
}));

/** English-only translator for React islands. */
export function useI18n() {
  return { t: translate };
}
