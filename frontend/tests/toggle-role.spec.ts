import { test, expect } from './fixtures';
import { seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await seed(page, 'buyer');
});

test('role switch from the account menu flips the buyer shell to the seller home', async ({ page }) => {
  await page.goto('/app/buy');
  await expect(page.getByRole('heading', { name: 'Stalls around you' })).toBeVisible();

  // the header has no role control any more; the switch lives in the account menu
  await expect(page.getByRole('radiogroup', { name: /Who are you/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /Switch to seller/ }).click();

  await expect(page).toHaveURL(/\/app\/seller\/simple$/);
  await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible();
  await page.goto('/app/seller/simple/deals');
  await expect(page).toHaveURL(/\/app\/seller\/simple\/deals$/);
});
