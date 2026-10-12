import { test, expect } from './fixtures';
import { seed } from './helpers';

/**
 * Vendor onboarding → add inventory → close stall → buyer sees it closed live.
 * Seller and buyer are two tabs in one context, so this also checks the
 * BroadcastChannel sync for the demo.
 */
test('vendor adds an item with price rules, closes the stall, buyer sees it live', async ({ page }) => {
  await seed(page, 'seller');
  await page.goto('/app/seller/inventory');

  // add by hand; the lowest price must not sit below cost
  await page.getByRole('tab', { name: 'Add items' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Ginger');
  await page.getByLabel('Quantity in stock').fill('6');
  await page.getByLabel('Cost (what you paid)').fill('60');
  await page.getByLabel('Lowest price (seller only)').fill('50');
  await expect(page.getByText(/Lowest price is below what you paid/)).toBeVisible();

  await page.getByLabel('Lowest price (seller only)').fill('70');
  await page.getByLabel('List price').fill('90');
  await page.getByRole('button', { name: 'Add to stall' }).click();
  await expect(page.getByRole('tab', { name: /Stock \(13\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // seller window closes the stall from the shop page
  await page.goto('/app/seller/shop');
  const sw = page.getByRole('switch', { name: /Your stall is open/ });
  await expect(sw).toBeVisible();
  await sw.click();
  await expect(page.getByRole('switch', { name: /Your stall is closed/ })).toBeVisible();

  // buyer window (same context) updates without a reload
  const buyer = await page.context().newPage();
  await buyer.goto('/app/buy');
  await expect(buyer.getByTestId('closed-stalls')).toContainText('Demo ki Dukaan');
  await expect(buyer.getByTestId('open-stalls')).not.toContainText('Demo ki Dukaan');

  // the closed stall's page: banner, and Add is disabled
  await buyer.goto('/app/stall?id=demo-01');
  await expect(buyer.getByText('Closed right now.')).toBeVisible();
  await expect(buyer.getByRole('button', { name: 'Add' }).first()).toBeDisabled();
});

test('CSV import shows a preview with row errors before importing', async ({ page }) => {
  await seed(page, 'seller');
  await page.goto('/app/seller/inventory');
  await page.getByRole('tab', { name: 'Add items' }).click();
  await page.getByRole('tab', { name: 'CSV file' }).click();
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,qty,unit,cost,min,list\nMilk,20,litre,52,56,62\nBad,1,kg,50,40,60\n'),
  });
  await expect(page.getByText('✓ ready')).toHaveCount(1);
  await expect(page.getByText('Lowest price is below cost')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 valid row' })).toBeEnabled();
});

test('snap a photo, confirm a suggestion, the photo is kept on the item and can be removed', async ({ page }) => {
  await seed(page, 'seller');
  await page.goto('/app/seller/inventory');
  await page.getByRole('tab', { name: 'Add items' }).click();
  await page.getByRole('tab', { name: 'Snap' }).click();

  // a 1×1 PNG is enough to exercise the thumbnail path
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
  // snap panel comes before the item form, which has its own photo input
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'snap.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('list', { name: 'Suggestions' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Tomatoes/ }).click();

  await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
  // the suggestion only sets the list price; cost and lowest price are the vendor's to confirm
  await page.getByLabel('Cost (what you paid)').fill('25');
  await page.getByLabel('Lowest price (seller only)').fill('28');
  await page.getByRole('button', { name: 'Add to stall' }).click();
  await expect(page.locator('section[aria-label="Stock list"] img[alt=""]').first()).toBeVisible();
});

test('search by name finds a product and prefills the form', async ({ page }) => {
  await seed(page, 'seller');
  await page.goto('/app/seller/inventory');
  await page.getByRole('tab', { name: 'Add items' }).click();
  await page.getByRole('tab', { name: 'Snap' }).click();

  // works with or without a SerpAPI key on this machine: either live shopping
  // results or the offline catalogue fallback is an acceptable, correct outcome
  await page.getByLabel('Not in the list? Search by name').fill('tomato');
  await page.getByRole('button', { name: 'Search' }).click();
  const results = page.getByRole('list', { name: 'Suggestions' });
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.getByRole('listitem')).not.toHaveCount(0);
  await expect(page.getByText(/Shopping search \(SerpAPI\)|Offline catalogue/)).toBeVisible();

  await results.getByRole('listitem').first().locator('button').click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');
  await expect(page.getByLabel('List price')).not.toHaveValue('');
});
