import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test`/`expect` from here instead of '@playwright/test'
 * directly. It sets window.__MOLTOL_SKIP_DEMO__ before any page script runs,
 * on every test, seeded or not — DemoProvisioner (src/components/react/
 * DemoProvisioner.tsx) checks this flag and skips auto-provisioning.
 *
 * Why this has to be global, not just inside seed(): a spec that visits a page
 * without seeding (an anonymous-visitor test, say) would otherwise still race
 * DemoProvisioner's own IndexedDB write against whatever that spec expects,
 * and a spec that does call seed() has its own seeded IndexedDB write race
 * DemoProvisioner's write for the exact same key — both are genuinely
 * concurrent writers, not a staleness problem a hydration-wait can fix.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as unknown as { __MOLTOL_SKIP_DEMO__: boolean }).__MOLTOL_SKIP_DEMO__ = true;
    });
    await use(page);
  },
});

export { expect };
