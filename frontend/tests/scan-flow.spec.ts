import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await seed(page, 'seller');
});

// Headless Playwright Chromium has no built-in LanguageModel API, so the
// scanner must degrade to the manual picker — exactly what phones do today.
test('scan: falls back to manual picker, creates a product that lands in price', async ({ page }) => {
  await page.goto('/app/seller/simple/scan');

  // no on-device AI in CI → the "Choose manually" path is the entry.
  // The island hydrates a few ms after render, so re-tap until the picker opens.
  await openPicker(page);

  // pick "Potato" from the manual grid
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

async function openPicker(page: Page) {
  const manual = page.getByRole('button', { name: /Choose manually/ }).last();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await manual.click().catch(() => undefined);
    const opened = await page.getByRole('button', { name: /Potato/ }).count();
    if (opened > 0) return;
    await page.waitForTimeout(500);
  }
  throw new Error('manual picker did not open');
}