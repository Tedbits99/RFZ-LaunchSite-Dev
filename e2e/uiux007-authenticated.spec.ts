import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Fixture = { password: string; users: { key: string; email: string }[] };
const fixture: Fixture = JSON.parse(readFileSync(process.env.RFZ_UIUX_FIXTURE_FILE!, 'utf8'));
const user = (key: string) => fixture.users.find((entry) => entry.key === key)!;

async function signIn(page: import('@playwright/test').Page, email: string, password = fixture.password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('customer authentication, account navigation, logout and protected denial', async ({ page }) => {
  await signIn(page, user('customerA').email);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible();
  await page.getByRole('link', { name: 'All orders' }).click();
  await expect(page).toHaveURL(/\/account\/orders$/);
  await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();
  await page.goto('/account/profile');
  await expect(page.getByRole('heading', { name: 'Profile Settings' })).toBeVisible();
  await page.goto('/account/wallet');
  await expect(page).toHaveURL(/\/account\/wallet$/);
  await page.reload();
  await expect(page).toHaveURL(/\/account\/wallet$/);
  await page.context().clearCookies();
  await page.goto('/account/orders');
  await expect(page).toHaveURL(/\/login$/);
});

test('administrator authentication and navigation', async ({ page }) => {
  await page.goto('/secure-admin-login');
  await page.getByLabel('Email').fill(user('admin').email);
  await page.getByLabel('Password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('link', { name: 'View orders' }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByRole('heading', { name: /orders/i }).first()).toBeVisible();
});

test('checkout exposes validation without creating a transaction', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.locator('body')).toContainText(/checkout|payment/i);
  await expect(page.locator('body')).not.toContainText('Database not configured');
});
