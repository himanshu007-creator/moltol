import { test, expect } from './fixtures';
import { seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await seed(page, 'buyer');
});

test('buyer: haggle all, take one lane over, pay, land on orders', async ({ page }) => {
  await page.goto('/app/buy');

  // enter the closest stall
  await page.getByRole('link', { name: /Ramesh ka thela/ }).first().click();
  await expect(page).toHaveURL(/\/app\/stall\?id=thela-01/);

  // add two items to the basket (the Add click can land before the island hydrates — retry until the stepper responds)
  const addFirst = page.getByRole('button', { name: 'Add', exact: true }).first();
  await expect(async () => {
    await addFirst.click();
    await expect(page.getByRole('button', { name: 'Remove one', exact: true }).first()).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('link', { name: /View basket/ }).click();
  await expect(page).toHaveURL('/app/cart');

  // begin the parallel haggle
  await page.getByRole('button', { name: 'Start haggling' }).click();
  await expect(page).toHaveURL('/app/bazaar');

  // take manual control of the longest lane and accept it on our terms
  const takeOver = page.getByRole('button', { name: 'Take over' }).last();
  await expect(takeOver).toBeVisible({ timeout: 20_000 });
  await takeOver.click();
  const acceptAt = page.getByRole('button', { name: /Accept at/ }).last();
  await expect(acceptAt).toBeVisible({ timeout: 10_000 });
  await acceptAt.click();

  // let the remaining lanes finish, then prove & pay
  const payLink = page.getByRole('link', { name: /Proof & pay/ });
  await expect(payLink).toBeVisible({ timeout: 40_000 });
  await payLink.click();
  await expect(page).toHaveURL('/app/checkout');

  // ready stage shows the merged bill and a big Pay button
  await expect(page.getByRole('button', { name: /Pay now/ })).toBeVisible();
  await page.getByRole('button', { name: /Pay now/ }).click();

  // paying -> proof (auto-plays, no click) -> done
  await expect(page.getByText('Sandbox demo')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Paid and proved')).toBeVisible({ timeout: 20_000 });

  // wait for the hash-verify animation to settle before scrolling to the next button
  await expect(page.getByText('Verified SHA-256')).toBeVisible({ timeout: 10_000 });
  // proof written -> orders page
  await page.getByRole('button', { name: /My orders/ }).click();
  await expect(page).toHaveURL('/app/orders');
  await expect(page.getByText(/Ramesh ka thela/).first()).toBeVisible();
});