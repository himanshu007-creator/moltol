import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/lib/idb';
import { migratePath, type SellerMode } from '@/lib/routes';
import { DEMO_USER } from '@/lib/mock/seeds';

/**
 * The full session lives in IndexedDB (see idbStorage) — that's the source of
 * truth and what you inspect to inform states end to end. But a few pre-paint
 * inline scripts (Base.astro's data-auth flag, the /app and /app/seller entry
 * redirects) need a synchronous read before IndexedDB can resolve. For that
 * narrow purpose only, a tiny hint `{loggedIn, activeRole, sellerMode}` is
 * mirrored to localStorage on every change. Never read it as real state.
 */
const AUTH_HINT_KEY = 'moltol-auth-hint';
function writeAuthHint(s: Pick<SessionState, 'loggedIn' | 'activeRole' | 'sellerMode'>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUTH_HINT_KEY, JSON.stringify({ loggedIn: s.loggedIn, activeRole: s.activeRole, sellerMode: s.sellerMode }));
  } catch {
    /* storage unavailable (private mode, quota) — the pre-paint scripts just fall back to /login */
  }
}

export type Role = 'buyer' | 'seller';

export interface SessionState {
  loggedIn: boolean;
  name: string;
  phone: string;
  avatarEmoji: string;
  /** Real backend account, once signed up/logged in via AuthForm. Empty/null
   *  for the local-only demo account (provisionDemo) and any pre-backend state. */
  email: string;
  token: string | null;
  activeRole: Role;
  buyerProfileDone: boolean;
  sellerProfileDone: boolean;
  lastRoute: { buyer: string; seller: string };
  /** the seller's chosen dashboard. null until they pick one. */
  sellerMode: SellerMode | null;
  setSellerMode: (mode: SellerMode) => void;
  /** non-blocking "switch to handle it" banner */
  pendingNote: string | null;
  /** set once, by logout, and never cleared by it: the one thing a full wipe
   *  must survive, so provisionDemo() can tell "never been used" apart from
   *  "the tester explicitly signed out" and never re-auto-logs-in after that. */
  everLoggedOut: boolean;

  login: (name: string, phone: string, avatarEmoji?: string) => void;
  /** Real backend login/signup (email + JWT), distinct from the phone-only demo `login`. */
  loginWithBackend: (email: string, token: string, avatarEmoji?: string) => void;
  /** Auto-log in as the demo dual-role account, once, on a true first visit only
   *  (never after an explicit logout — see Shell.tsx). Local, no-backend testing. */
  provisionDemo: () => void;
  /** Full reset: every field here goes back to blank (not just loggedIn), and
   *  every other persisted store resets too — see Shell.tsx's logout handler. */
  logout: () => void;
  switchRole: () => void;
  setRole: (role: Role, route: string) => void;
  markProfile: (role: Role) => void;
  setPending: (note: string | null) => void;
  rememberRoute: (route: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      loggedIn: false,
      name: '',
      phone: '',
      avatarEmoji: '🙍🏽‍♀️',
      email: '',
      token: null,
      activeRole: 'buyer',
      buyerProfileDone: false,
      sellerProfileDone: false,
      lastRoute: { buyer: '/app/buy', seller: '/app/seller/simple' },
      sellerMode: null,
      setSellerMode: (sellerMode) => set({ sellerMode }),
      pendingNote: null,
      everLoggedOut: false,

      login: (name, phone, avatarEmoji = '🙍🏽‍♀️') =>
        set({ loggedIn: true, name, phone, avatarEmoji }),

      loginWithBackend: (email, token, avatarEmoji = '🙍🏽‍♀️') =>
        set({ loggedIn: true, name: email.split('@')[0] ?? email, email, token, avatarEmoji }),

      provisionDemo: () => {
        if (get().everLoggedOut || get().loggedIn) return;
        set({
          loggedIn: true,
          name: DEMO_USER.name,
          phone: DEMO_USER.phone,
          avatarEmoji: DEMO_USER.avatarEmoji,
          activeRole: 'buyer',
          buyerProfileDone: true,
          sellerProfileDone: true,
          sellerMode: 'simple',
        });
      },

      logout: () =>
        set({
          loggedIn: false,
          name: '',
          phone: '',
          avatarEmoji: '🙍🏽‍♀️',
          email: '',
          token: null,
          activeRole: 'buyer',
          buyerProfileDone: false,
          sellerProfileDone: false,
          lastRoute: { buyer: '/app/buy', seller: '/app/seller/simple' },
          sellerMode: null,
          pendingNote: null,
          everLoggedOut: true,
        }),

      switchRole: () => {
        const next: Role = get().activeRole === 'buyer' ? 'seller' : 'buyer';
        set({ activeRole: next, pendingNote: null });
      },

      setRole: (role, route) => set({ activeRole: role, lastRoute: { ...get().lastRoute, [role]: route } }),
      markProfile: (role) =>
        set(role === 'buyer' ? { buyerProfileDone: true } : { sellerProfileDone: true }),
      setPending: (pendingNote) => set({ pendingNote }),
      rememberRoute: (route) => {
        const active = get().activeRole;
        set({ lastRoute: { ...get().lastRoute, [active]: route } });
      },
    }),
    {
      name: 'moltol-session',
      version: 4,
      storage: createJSONStorage(() => idbStorage),
      // v1 stored flat paths like /buy and /simple; map them to the /app routes.
      // v3 adds everLoggedOut — anyone migrating from an older version has never
      // used the new logout-wipe/auto-provision pair, so it defaults to false.
      // v4 adds email/token for real backend accounts — empty/null for anyone
      // migrating from before auth was real (the demo account, mainly).
      migrate: (state) => {
        const st = state as Partial<SessionState> & { lastRoute?: { buyer?: string; seller?: string } };
        return {
          ...st,
          sellerMode: st.sellerMode ?? null,
          everLoggedOut: st.everLoggedOut ?? false,
          email: st.email ?? '',
          token: st.token ?? null,
          lastRoute: {
            buyer: migratePath(st.lastRoute?.buyer ?? '/buy'),
            seller: migratePath(st.lastRoute?.seller ?? '/simple'),
          },
        } as SessionState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) writeAuthHint(state);
      },
    },
  ),
);

// Keep the pre-paint hint in sync with every change (login, logout, role switch, mode pick).
useSession.subscribe((s) => writeAuthHint(s));