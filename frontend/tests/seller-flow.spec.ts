import { test, expect } from './fixtures';
import { seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await seed(page, 'seller');
});

test('seller: accept the incoming offer, see it in earnings', async ({ page }) => {
  await page.goto('/app/seller/simple/haggle');

  // a buyer's offer is waiting — accept it
  const accept = page.getByRole('button', { name: /✅/ });
  await expect(accept).toBeVisible();
  await accept.click();

  // green deal screen shows the accepted amount
  await expect(page.getByText('₹34').first()).toBeVisible({ timeout: 10_000 });

  // the deal lands in earnings
  await page.goto('/app/seller/simple/earnings');
  await expect(page.getByText('₹34').first()).toBeVisible();
});