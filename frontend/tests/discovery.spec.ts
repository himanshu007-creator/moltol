import { test, expect } from './fixtures';
import { seed, seedVenue } from './helpers';

const BAZAAR = { latitude: 31.2884, longitude: 75.5968, accuracy: 12 };

test.describe('buyer discovery', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, 'buyer');
  });

  test('shows only open stalls, sorted by distance, with GPS source', async ({ context, page }) => {
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:4331' });
    await context.setGeolocation(BAZAAR);
    await page.goto('/app/buy');

    // the demo's own stall is closest to the fake GPS position
    const rows = page.getByTestId('open-stalls').getByRole('link');
    await expect(rows.first()).toContainText('Demo ki Dukaan');
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: 'Barry sabziwala' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Magan fruitwala' })).toHaveCount(1);
    await expect(page.getByText('source: gps')).toBeVisible();
  });

  test('falls back to walking when GPS is denied, and offers a retry', async ({ page }) => {
    await page.goto('/app/buy');

    await expect(page.getByText('source: walk')).toBeVisible();
    await expect(page.getByRole('button', { name: /Try GPS again/ })).toBeVisible();
    // walking distances: the demo's own stall is closest at 60 m
    await expect(page.getByTestId('open-stalls').getByRole('link').first()).toContainText('Demo ki Dukaan');
    await expect(page.getByTestId('open-stalls')).toContainText('Ramesh ka thela');
  });

  test('shows a closed stall greyed under "Closed now", outside the open list', async ({ page }) => {
    await seedVenue(page, ['demo-01']);
    await page.goto('/app/buy');

    const rows = page.getByTestId('open-stalls');
    await expect(rows.getByRole('link').first()).toBeVisible();
    await expect(rows).not.toContainText('Demo ki Dukaan');
    await expect(rows).toContainText('Ramesh ka thela');
    await expect(page.getByTestId('closed-stalls')).toContainText('Demo ki Dukaan');
  });
});

test.describe('stall status sync', () => {
  test('seller closes stall in Simple Mode → hidden for buyers', async ({ page }) => {
    await seed(page, 'seller');
    await page.goto('/app/seller/simple');

    // stall opens by default — flip the switch off (labels are localized to hi).
    // The click can land before the island hydrates, so retry until the toggle flips.
    const sw = page.getByRole('switch');
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(async () => {
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 1_500 });
    }).toPass({ timeout: 15_000 });

    // the venue store writes to IndexedDB asynchronously; let the write commit before the buyer page loads
    await page.waitForTimeout(500);
    // buyer no longer discovers it (shared venue store)
    await page.goto('/app/buy');
    const rows = page.getByTestId('open-stalls');
    await expect(rows).not.toContainText('Demo ki Dukaan');
    await expect(rows).toContainText('Ramesh ka thela');
    await expect(page.getByTestId('closed-stalls')).toContainText('Demo ki Dukaan');
  });

  test('vendor console switch toggles the same shared state', async ({ page }) => {
    await seed(page, 'seller');
    await page.goto('/app/seller/shop');

    const sw = page.getByRole('switch', { name: /Your stall is open/ });
    await expect(sw).toBeVisible();
    await sw.click();
    await expect(page.getByRole('switch', { name: /Your stall is closed/ })).toBeVisible();
  });
});
test.describe('walk up and enter', () => {
  test('walking to a stall moves the dot and prompts to enter it', async ({ page }) => {
    await seed(page, 'buyer');
    await page.goto('/app/buy');

    // Ramesh's thela is ~70 m from the start, so the walk takes a few seconds
    await page.getByRole('button', { name: /Walk to Ramesh ka thela/ }).click();
    const prompt = page.getByRole('alertdialog');
    await expect(prompt).toContainText("You're at Ramesh ka thela", { timeout: 45_000 });
    await page.getByRole('button', { name: 'Enter stall' }).click();
    await expect(page).toHaveURL(/\/app\/stall\?id=thela-01/);
  });

  test('"Not now" hides the prompt for that stall', async ({ page }) => {
    await seed(page, 'buyer');
    await page.goto('/app/buy');
    await page.getByRole('button', { name: /Walk to Demo ki Dukaan/ }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
