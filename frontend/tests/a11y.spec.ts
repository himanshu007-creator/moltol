import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { seed } from './helpers';

const PAGES = [
  '/',
  '/login',
  '/signup',
  '/app/buy',
  '/app/stall',
  '/app/checkout',
  '/app/receipt',
  '/app/orders',
  '/app/seller/inventory',
  '/app/seller/ledger',
  '/app/seller/shop',
  '/app/insights',
  '/app/cart',
  '/app/seller/simple/setup',
  '/app/seller/simple',
  '/app/seller/simple/price',
  '/app/seller/simple/deals',
  '/app/seller/simple/earnings',
  '/app/seller/simple/settings',
] as const;
// pages that need a logged-in session
const NEEDS_SESSION = new Set([
  '/app/stall',
  '/app/checkout',
  '/app/receipt',
  '/app/orders',
  '/app/seller/inventory',
  '/app/seller/ledger',
  '/app/seller/shop',
  '/app/insights',
  '/app/cart',
  '/app/seller/simple/setup',
  '/app/seller/simple',
  '/app/seller/simple/price',
  '/app/seller/simple/deals',
  '/app/seller/simple/earnings',
  '/app/seller/simple/settings',
]);

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