import { expect, test } from '@playwright/test';

test.describe('UIUX-007 visual regression', () => {
  test('homepage keeps the responsive storefront geometry and captures evidence', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Cheapest Game Top-Up/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'RunFazone home' })).toBeVisible();
    await expect(page.locator('#games .grid.grid-cols-2').first()).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      gridDisplay: getComputedStyle(document.querySelector('#games .grid')!).display,
      logoWidth: document.querySelector('a[aria-label="RunFazone home"]')?.getBoundingClientRect().width ?? 0,
    }));

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.gridDisplay).toBe('grid');
    expect(geometry.logoWidth).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);

    await page.screenshot({ path: testInfo.outputPath('homepage.png'), fullPage: true });
  });

  test('theme controls remain keyboard-operable with persisted visual state', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const html = page.locator('html');
    const theme = page.locator('[data-theme-option="night"]');

    await expect(html).toHaveAttribute('data-theme-ready', 'true');
    await theme.focus();
    await page.keyboard.press('Enter');
    await expect(theme).toHaveAttribute('aria-pressed', 'true');
    await expect(html).toHaveAttribute('data-theme', 'night');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveAttribute('data-theme', 'night');
  });

  test('mobile navigation remains reachable beside the appearance control', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 999) > 600, 'mobile navigation case');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const menu = page.getByRole('button', { name: 'Open menu' });
    const appearance = page.locator('.theme-selector-global');
    await expect(menu).toBeVisible();
    await expect(appearance).toBeVisible();

    const geometry = await Promise.all([menu.boundingBox(), appearance.boundingBox()]);
    const menuBox = geometry[0];
    const appearanceBox = geometry[1];
    expect(menuBox).not.toBeNull();
    expect(appearanceBox).not.toBeNull();
    expect(menuBox!.x + menuBox!.width <= appearanceBox!.x || appearanceBox!.x + appearanceBox!.width <= menuBox!.x || menuBox!.y + menuBox!.height <= appearanceBox!.y || appearanceBox!.y + appearanceBox!.height <= menuBox!.y).toBe(true);

    await menu.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Top Up' })).toBeVisible();
  });
});
