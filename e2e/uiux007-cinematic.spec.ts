import { expect, test } from '@playwright/test';

test.use({ video: 'on', trace: 'on' });

test.describe('UIUX-007 cinematic hero', () => {
  test('runs distinct artwork presets with accessible controls', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    const hero = page.getByTestId('rfz-cinematic-hero');
    const art = page.getByTestId('rfz-cinematic-art');
    await expect(hero).toHaveAttribute('data-animation-preset', 'holographic-reveal');
    await expect(art).toBeVisible();
    await expect(page.locator('.rfz-cinematic-copy, .rfz-cinematic-scrim, .rfz-cinematic-kicker')).toHaveCount(0);
    await expect(page.locator('.rfz-cinematic-control-strip')).toBeVisible();
    const heroBox = await hero.boundingBox();
    const controlsBox = await page.locator('.rfz-cinematic-control-strip').boundingBox();
    expect(heroBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(controlsBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height - 1);
    expect(await art.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain');
    expect(await art.evaluate((element) => getComputedStyle(element).animationName)).toContain('rfz-holographic-reveal');

    await page.getByRole('button', { name: 'Next promotion' }).click();
    await expect(hero).toHaveAttribute('data-animation-preset', 'cinematic-depth');
    await expect(hero).toHaveAttribute('data-scene-index', '1');
    expect(await page.getByTestId('rfz-cinematic-art').getAttribute('src')).toContain('banner-02.webp');
    expect(await page.getByTestId('rfz-cinematic-art').evaluate((element) => getComputedStyle(element).animationName)).toContain('rfz-cinematic-depth');

    await page.getByRole('button', { name: 'Next promotion' }).click();
    await expect(hero).toHaveAttribute('data-animation-preset', 'futuristic-energy');
    await expect(hero).toHaveAttribute('data-scene-index', '2');
    expect(await page.getByTestId('rfz-cinematic-art').evaluate((element) => getComputedStyle(element).animationName)).toContain('rfz-futuristic-energy');

    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.mouse.move(0, 0);
    const pause = page.locator('.rfz-cinematic-controls button').nth(1);
    await pause.click();
    await expect(hero).toHaveAttribute('data-paused', 'true');
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Play banner animation' }).click();
    await expect(hero).toHaveAttribute('data-paused', 'false');

    await expect(page.getByRole('tablist', { name: 'Featured promotions' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
    expect(overflow).toBe(true);
  });

  test('supports keyboard scene navigation and indicator semantics', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hero = page.getByTestId('rfz-cinematic-hero');
    await hero.focus();
    await page.keyboard.press('ArrowRight');
    await expect(hero).toHaveAttribute('data-scene-index', '1');
    await page.keyboard.press('End');
    await expect(hero).toHaveAttribute('data-scene-index', '2');
    await expect(page.getByRole('tab', { name: 'Show promotion 3' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(hero).toHaveAttribute('data-scene-index', '0');
  });

  test('supports touch swipe on mobile without horizontal overflow', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 999) > 600, 'mobile touch case');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hero = page.getByTestId('rfz-cinematic-hero');
    await hero.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 290, clientY: 140 });
    await hero.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 80, clientY: 140 });
    await expect(hero).toHaveAttribute('data-scene-index', '1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
    expect(overflow).toBe(true);
  });

  test('honors reduced motion and prevents autoplay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hero = page.getByTestId('rfz-cinematic-hero');
    await expect(hero).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.getByTestId('rfz-cinematic-art')).toHaveCSS('animation-name', 'none');
    await page.waitForTimeout(250);
    await expect(hero).toHaveAttribute('data-scene-index', '0');
  });

  test('keeps one theme control and contained artwork across supported widths', async ({ page }) => {
    for (const width of [320, 360, 390, 430, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-theme-toggle]:visible')).toHaveCount(1);
      await expect(page.getByTestId('rfz-cinematic-art')).toBeVisible();
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.body).toBeLessThanOrEqual(geometry.viewport);
    }
  });
});
