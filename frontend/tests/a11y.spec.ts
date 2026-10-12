import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { seed } from './helpers';

const PAGES = ['/', '/login', '/app/buy', '/app/seller/inventory', '/app/seller/ledger', '/app/insights', '/app/cart'] as const;
// pages that need a logged-in session
const NEEDS_SESSION = new Set(['/app/seller/inventory', '/app/seller/ledger', '/app/insights', '/app/cart']);

for (const path of PAGES) {
  test(`a11y: no critical/serious violations on ${path}`, async ({ page }) => {
    if (NEEDS_SESSION.has(path)) await seed(page, 'seller');
    await page.goto(path);
    // axe must see the settled page: islands hydrate and the shell fades in
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      bad.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
}