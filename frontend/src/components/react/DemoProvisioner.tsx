import { useEffect } from 'react';
import { useSession } from '@/stores/session';
import { useSimple } from '@/stores/simple';
import { whenHydrated } from '@/lib/hydrated';

/**
 * No backend yet: on a true first visit (never after an explicit logout — see
 * stores/session.ts), auto-logs in as the dual-role demo account so local e2e
 * testing of both buyer and seller flows needs no login screen. Mounted
 * unconditionally in Base.astro (landing included), since Shell only exists
 * on /app/* pages and a first visit can land anywhere. Both provisionDemo()
 * actions are internally idempotent — but each must wait for its own
 * IndexedDB hydration first, or it checks the pre-load defaults and
 * provisions over (or races) whatever was actually persisted, e.g. state a
 * test harness seeded directly into IndexedDB before the page loaded.
 */
export default function DemoProvisioner() {
  const loggedIn = useSession((s) => s.loggedIn);

  useEffect(() => {
    // The Playwright harness seeds its own state straight into IndexedDB
    // (tests/helpers.ts) before the page loads, and sets this flag in the same
    // init script. Provisioning here too would race that write for the same
    // IndexedDB key — not a case the hydration-wait below can fix, since both
    // writers are legitimately concurrent, not stale.
    if (typeof window !== 'undefined' && (window as { __MOLTOL_SKIP_DEMO__?: boolean }).__MOLTOL_SKIP_DEMO__) return;
    const unsubs = [
      whenHydrated(useSession, () => useSession.getState().provisionDemo()),
      whenHydrated(useSimple, () => useSimple.getState().provisionDemo()),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, []);

  // Shell.tsx sets the same flag on /app/* pages; this mirrors it on the
  // landing page too, so "Get started" flips to "Open app" right after
  // auto-provisioning, with no reload needed.
  useEffect(() => {
    if (loggedIn) document.documentElement.dataset.auth = '1';
    else delete document.documentElement.dataset.auth;
  }, [loggedIn]);

  return null;
}
