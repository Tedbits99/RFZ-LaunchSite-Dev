import { expect, test, type Response as PlaywrightResponse } from '@playwright/test';

async function navigateWithDevServerRecovery(page: import('@playwright/test').Page, route: string) {
  let response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  if ((response?.status() ?? 599) < 500) return response;

  // Next dev can return a transient 500 while compiling a route after the
  // preceding project finishes. Repeat the real navigation instead of
  // reloading the current document: an authorization redirect can detach the
  // frame during reload and produce ERR_ABORTED before the login boundary is
  // observable. The caller still asserts the final response and page state.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      if ((response?.status() ?? 599) < 500) return response;
    } catch (error) {
      if (!(error instanceof Error) || !/ERR_ABORTED|frame was detached/.test(error.message)) {
        throw error;
      }
    }
  }

  return response;
}

function expectNavigationResponseOrRedirect(
  response: PlaywrightResponse | null,
  page: import('@playwright/test').Page,
  route: string,
) {
  if (response) {
    expect(response.status(), `${route} response`).toBeLessThan(500);
  } else {
    // Playwright may not expose a response when the navigation is completed
    // by a redirect/client transition. Treat that as an explicit redirect
    // case; it is not an implicit pass for a missing response.
    expect(page.url(), `${route} redirect URL`).toMatch(/\/login(?:\?|$)/);
  }
}

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
  test('public routes render without server errors', async ({ page }) => {
    test.setTimeout(90_000);
    for (const route of publicRoutes) {
      const response = await navigateWithDevServerRecovery(page, route);
      expectNavigationResponseOrRedirect(response, page, route);
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  test('appearance modes persist, remain keyboard reachable, and keep route navigation stable', async ({ page }) => {
    await navigateWithDevServerRecovery(page, '/login');
    const html = page.locator('html');
    const selector = (theme: string) => page.locator(`[data-theme-option="${theme}"]`);
    if (await html.getAttribute('data-theme-ready') !== 'true') {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await expect(html).toHaveAttribute('data-theme-ready', 'true');

    for (const theme of ['light', 'dark', 'night']) {
      await selector(theme).focus();
      await expect(selector(theme)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(html).toHaveAttribute('data-theme', theme);
      await page.reload();
      await expect(html).toHaveAttribute('data-theme', theme);
    }

    await page.goto('/privacy-policy', { waitUntil: 'domcontentloaded' });
    await expect(html).toHaveAttribute('data-theme-ready', 'true');
    await expect(html).toHaveAttribute('data-theme', 'night');
    await selector('dark').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('UIUX-007 anonymous authorization boundaries', () => {
  for (const route of customerProtectedRoutes) {
    test(`${route} denies an anonymous customer session`, async ({ page }) => {
      const response = await navigateWithDevServerRecovery(page, route);
      expectNavigationResponseOrRedirect(response, page, route);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }

  for (const route of adminProtectedRoutes) {
    test(`${route} denies an anonymous admin session`, async ({ page }) => {
      const response = await navigateWithDevServerRecovery(page, route);
      if (response) {
        expect(response.status(), `${route} response`).toBeLessThan(500);
      } else {
        // A client transition can complete without exposing a navigation
        // response. Require the actual authorization-denial surface instead
        // of treating a missing response as success.
        await expect(page.locator('[data-route-denial="not-found"]')).toBeVisible();
      }
      // AdminLayout returns the framework not-found surface for anonymous
      // requests. This intentionally avoids exposing admin route existence;
      // the response is 200 in Next's App Router despite the not-found UI.
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}(?:\\?|$)`));
      await expect(page.locator('[data-route-denial="not-found"]')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Overview');
      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }
});
