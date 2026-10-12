import { test, expect } from './fixtures';
import { seed } from './helpers';

test('landing has no app shell and no role switch', async ({ page }) => {
  await page.goto('/?stay=1');
  await expect(page.getByRole('heading', { name: /Haggle in the open/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: /Who are you/ })).toHaveCount(0);
});

test('a signed-in visit to / goes to the app', async ({ page }) => {
  await seed(page, 'buyer');
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/buy$/);
});

test('language switch translates the landing page and sets html lang', async ({ page }) => {
  await page.goto('/?stay=1');
  await page.getByRole('button', { name: 'Change language to Hindi' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByText('खुलकर मोल-तोल कीजिए।')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
});

test('seller chooses a mode in the account menu and gets the matching nav', async ({ page }) => {
  await seed(page, 'seller');
  await page.goto('/app/seller/simple');
  await page.getByRole('button', { name: /Account menu|खाता मेनू/ }).click();
  await page.getByRole('menuitemradio', { name: /Modern/ }).click();
  await expect(page).toHaveURL(/\/app\/seller\/inventory$/);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ledger' })).toBeVisible();
});
