/**
 * Run `fn` once a zustand `persist` store has finished reading its IndexedDB-
 * backed state (or immediately, if it already has). Any correctness-sensitive
 * action gated on current store state — not just a render — must wait for
 * this: checking state before hydration sees the pre-load defaults, not what
 * was actually persisted, which silently does the wrong thing instead of
 * erroring (e.g. provisioning a demo account over seeded state, or a "resume"
 * guard seeing stage 'idle' and no-oping forever).
 */
export function whenHydrated<T>(store: { persist: { hasHydrated(): boolean; onFinishHydration(cb: (state: T) => void): () => void } }, fn: () => void): (() => void) | void {
  if (store.persist.hasHydrated()) {
    fn();
    return;
  }
  return store.persist.onFinishHydration(() => fn());
}
