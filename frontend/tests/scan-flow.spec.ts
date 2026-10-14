import { test, expect } from './fixtures';
import { seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await seed(page, 'seller');
});

// Chrome's on-device model (window.LanguageModel) is experimental and can hang
// indefinitely with no reliable timeout signal, so the manual picker is the
// default landing phase, not a fallback behind a "Choose manually" tap —
// exactly what every phone sees today.
test('scan: manual picker is the default, creates a product that lands in price', async ({ page }) => {
  await page.goto('/app/seller/simple/scan');

  // pick "Potato" from the manual grid, already open on load
  const potato = page.getByRole('button', { name: /Potato/ }).first();
  await expect(potato).toBeVisible();
  await potato.click();

  // creation form is pre-filled with the recognised vegetable
  await expect(page.getByText('New product')).toBeVisible();
  await expect(page.getByText('Potato').first()).toBeVisible();

  // enter a price of ₹40 and publish
  await page.getByPlaceholder('₹').fill('40');
  await page.getByRole('button', { name: /Publish/ }).click();

  // redirect lands on the price screen with the new listing
  await expect(page).toHaveURL(/\/app\/seller\/simple\/price/);
  await expect(page.getByText('Potato')).toBeVisible();
  await expect(page.getByText('₹40').first()).toBeVisible();
});
