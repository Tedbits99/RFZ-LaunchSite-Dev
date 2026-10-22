import { expect, test } from '@playwright/test';

const publicRoutes = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/auth/confirmation',
  '/auth/reset-password',
  '/checkout',
  '/track-order',
  '/secure-admin-login',
  '/copyright-disclaimer',
  '/payment-policy',
  '/privacy-policy',
  '/refund-policy',
  '/terms-of-service',
] as const;

const customerProtectedRoutes = [
  '/account',
  '/account/orders',
  '/account/orders/00000000-0000-0000-0000-000000000000',
  '/account/profile',
  '/account/wallet',
] as const;

const adminProtectedRoutes = [
  '/admin',
  '/admin/activity-log',
  '/admin/analytics',
  '/admin/announcements',
  '/admin/approvals',
  '/admin/blocklist',
  '/admin/bulk-pricing',
  '/admin/customers',
  '/admin/export',
  '/admin/games',
  '/admin/games/00000000-0000-0000-0000-000000000000/packages',
  '/admin/ml-offer-pricing',
  '/admin/notifications',
  '/admin/orders',
  '/admin/orders/00000000-0000-0000-0000-000000000000',
  '/admin/payments',
  '/admin/pricing',
  '/admin/promotions',
  '/admin/reconciliation',
  '/admin/refunds',
  '/admin/risk-alerts',
  '/admin/roles',
  '/admin/security',
  '/admin/settings',
  '/admin/staff',
  '/admin/suppliers',
  '/admin/suppliers/controlled-test-order',
  '/admin/suppliers/fazercards-catalog',
  '/admin/system-health',
  '/admin/tasks',
  '/admin/tickets',
  '/admin/vouchers',
] as const;

test.describe('UIUX-007 public route acceptance', () => {
  for (const route of publicRoutes) {
    test(`${route} renders without a server error`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} response`).toBeLessThan(500);
      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }

  test('appearance modes persist, remain keyboard reachable, and keep route navigation stable', async ({ page }) => {
    await page.goto('/login');
    const html = page.locator('html');
    const selector = (theme: string) => page.locator(`[data-theme-option="${theme}"]`);

    for (const theme of ['light', 'dark', 'night']) {
      await selector(theme).focus();
      await expect(selector(theme)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(html).toHaveAttribute('data-theme', theme);
      await page.reload();
      await expect(html).toHaveAttribute('data-theme', theme);
    }

    await page.goto('/privacy-policy');
    await expect(html).toHaveAttribute('data-theme', 'night');
    await selector('dark').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('UIUX-007 anonymous authorization boundaries', () => {
  for (const route of [...customerProtectedRoutes, ...adminProtectedRoutes]) {
    test(`${route} denies an anonymous browser session`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} response`).toBeLessThan(500);
      if (route.startsWith('/admin')) {
        // AdminLayout intentionally returns notFound for anonymous requests;
        // this avoids leaking route existence while preserving a normal page.
        await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}(?:\\?|$)`));
        expect(response?.status(), `${route} anonymous status`).toBe(404);
      } else {
        await expect(page).toHaveURL(/\/login(?:\?|$)/);
      }
      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }
});
