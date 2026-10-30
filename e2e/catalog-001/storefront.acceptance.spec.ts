import { expect, test } from '@playwright/test';
import { createGame, createPackage, serviceDb, writeEvidence } from './fixture-support';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
});

function checkoutBody(gameId: string, packageId: string, email: string) {
  return { gameId, packageId, email, name: 'Synthetic Acceptance Customer', playerInputs: { player_id: 'synthetic' }, paymentMethod: 'manual' };
}

test.describe('CATALOG-001 storefront and checkout acceptance', () => {
  test('draft, hidden, and archived games are not purchasable', async ({ page }, testInfo) => {
    const draft = await createGame(testInfo, 'not-published');
    const hidden = await createGame(testInfo, 'hidden', { published: true });
    const archived = await createGame(testInfo, 'archived', { published: true });
    const draftPackage = await createPackage(draft.id, { name: 'Draft package', sku: `${draft.slug}-p`, priceCents: 100, status: 'PUBLISHED' });
    const hiddenPackage = await createPackage(hidden.id, { name: 'Hidden package', sku: `${hidden.slug}-p`, priceCents: 200, status: 'PUBLISHED' });
    const archivedPackage = await createPackage(archived.id, { name: 'Archived package', sku: `${archived.slug}-p`, priceCents: 300, status: 'PUBLISHED' });
    const hiddenResult = await serviceDb().from('games').update({ catalog_status: 'DRAFT', is_active: false, published_at: null }).eq('id', hidden.id);
    const archivedResult = await serviceDb().from('games').update({ catalog_status: 'ARCHIVED', is_active: false, published_at: null }).eq('id', archived.id);
    expect(hiddenResult.error).toBeNull();
    expect(archivedResult.error).toBeNull();

    const cases = [
      [draft, draftPackage, 'DRAFT'],
      [hidden, hiddenPackage, 'DRAFT'],
      [archived, archivedPackage, 'ARCHIVED'],
    ] as const;
    for (const [game, pkg, expectedStatus] of cases) {
      const { data: savedGame, error: savedGameError } = await serviceDb().from('games').select('catalog_status,is_active').eq('id', game.id).single();
      expect(savedGameError).toBeNull();
      expect(savedGame, `fixture state before storefront request for ${game.slug}`).toMatchObject({
        catalog_status: expectedStatus,
        is_active: false,
      });
      const response = await page.goto(`/games/${game.slug}`);
      const gameHeadingCount = await page.getByRole('heading', { name: game.name, exact: true }).count();
      expect(response?.status(), `non-saleable game route should be unavailable: ${game.slug}; game heading count=${gameHeadingCount}`).toBe(404);
      const checkout = await page.request.post('/api/orders', { data: checkoutBody(game.id, pkg.id, `${game.slug}@example.invalid`) });
      expect(checkout.status()).toBe(400);
    }
    const { data: orders, error } = await serviceDb().from('orders').select('id').in('email', cases.map(([game]) => `${game.slug}@example.invalid`));
    expect(error).toBeNull();
    expect(orders).toHaveLength(0);
    await writeEvidence(page, testInfo, { action: 'non_saleable_games', routes_not_found: cases.length, checkout_rejections: cases.length, orders_created: orders?.length });
  });

  test('published packages are sorted and unavailable packages cannot enter checkout', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'package-sort', { published: true });
    await createPackage(game.id, { name: 'Unavailable low sort', sku: `${game.slug}-draft`, priceCents: 100, sortOrder: 0, status: 'DRAFT', active: false });
    const later = await createPackage(game.id, { name: 'Synthetic Later Package', sku: `${game.slug}-later`, priceCents: 800, sortOrder: 8, status: 'PUBLISHED' });
    const first = await createPackage(game.id, { name: 'Synthetic First Package', sku: `${game.slug}-first`, priceCents: 400, sortOrder: 2, status: 'PUBLISHED' });
    await page.goto(`/games/${game.slug}`);
    const group = page.getByRole('radiogroup', { name: `${game.name} packages` });
    const names = await group.locator('label').allTextContents();
    expect(names.findIndex((name) => name.includes('Synthetic First Package')), `published package missing from storefront: ${names.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(names.findIndex((name) => name.includes('Synthetic Later Package')), `published package missing from storefront: ${names.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(names.findIndex((name) => name.includes('Synthetic First Package'))).toBeLessThan(names.findIndex((name) => name.includes('Synthetic Later Package')));
    expect(names.join(' ')).not.toContain('Unavailable low sort');
    const { data: draftPackage } = await serviceDb().from('packages').select('id').eq('game_id', game.id).eq('catalog_status', 'DRAFT').single();
    expect(draftPackage).toBeTruthy();
    const response = await page.request.post('/api/orders', { data: checkoutBody(game.id, draftPackage!.id, `${game.slug}-draft@example.invalid`) });
    expect(response.status()).toBe(400);
    const { data: orders, error } = await serviceDb().from('orders').select('id').eq('email', `${game.slug}-draft@example.invalid`);
    expect(error).toBeNull();
    expect(orders).toHaveLength(0);
    await writeEvidence(page, testInfo, { action: 'package_visibility_and_checkout', order: names.map((name) => name.includes('First') ? first.id : name.includes('Later') ? later.id : null).filter(Boolean), unavailable_package_checkout_status: response.status(), orders_created: orders?.length });
  });

  test('a published game with no approved packages shows the unavailable state', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'empty-storefront', { published: true });
    await createPackage(game.id, { name: 'Draft only package', sku: `${game.slug}-draft`, priceCents: 100, status: 'DRAFT', active: false });
    await page.goto(`/games/${game.slug}`);
    await expect(page.getByRole('status').filter({ hasText: 'Packages temporarily unavailable' })).toBeVisible();
    await writeEvidence(page, testInfo, { action: 'empty_storefront', unavailable_message_visible: true });
  });

  test('missing game artwork uses the initials fallback', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'safe-artwork-fallback', { published: true });
    await page.goto(`/games/${game.slug}`);
    await expect(page.getByRole('heading', { name: game.name, exact: true })).toBeVisible();
    await expect(page.getByText('SS', { exact: true })).toBeVisible();
    await writeEvidence(page, testInfo, { action: 'artwork_fallback', initials_fallback_visible: true });
  });

  test('required player fields validate without calling a player-verification provider', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'required-player-validation', { published: true });
    await createPackage(game.id, { name: 'Synthetic standard package', sku: `${game.slug}-standard`, priceCents: 500, status: 'PUBLISHED' });
    await page.goto(`/games/${game.slug}`);
    await page.getByRole('button', { name: 'Verify Player' }).click();
    await expect(page.getByText('Enter your Player ID first.', { exact: true })).toBeVisible();
    await page.locator('#player-player_id').fill('synthetic-player');
    const blockedExternalRequests: string[] = [];
    page.on('requestfailed', (request) => { if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) blockedExternalRequests.push(new URL(request.url()).hostname); });
    await page.getByRole('button', { name: 'Verify Player' }).click();
    await expect(page.getByRole('status')).toContainText('Details saved. You can proceed to checkout.');
    expect(blockedExternalRequests).toEqual([]);
    await writeEvidence(page, testInfo, { action: 'required_player_validation', missing_field_rejected: true, synthetic_field_accepted: true, external_provider_requests: blockedExternalRequests.length });
  });

  test('desktop and mobile storefront layouts have no horizontal overflow', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'responsive-layout', { published: true });
    await createPackage(game.id, { name: 'Synthetic Responsive Package', sku: `${game.slug}-responsive`, priceCents: 750, status: 'PUBLISHED' });
    await page.goto(`/games/${game.slug}`);
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    await writeEvidence(page, testInfo, { action: 'responsive_layout', ...dimensions, no_horizontal_overflow: true });
  });

test('storefront flow has no unexpected JavaScript exceptions or supplier/payment requests', async ({ page }, testInfo) => {
    const game = await createGame(testInfo, 'no-browser-errors', { published: true });
    await createPackage(game.id, { name: 'Synthetic Error Check Package', sku: `${game.slug}-errors`, priceCents: 600, status: 'PUBLISHED' });
    const errors: string[] = [];
    const blockedExternalRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name || 'PageError'));
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'data:') blockedExternalRequests.push(url.hostname);
    });
    await page.goto(`/games/${game.slug}`);
    await expect(page.getByRole('heading', { name: game.name, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    expect(blockedExternalRequests.filter((host) => /fazercards|paymongo|paypal|stripe/i.test(host))).toEqual([]);
    await writeEvidence(page, testInfo, {
      action: 'browser_errors', javascript_errors: errors,
      external_requests_blocked_by_loopback_policy: blockedExternalRequests.length,
      supplier_or_payment_requests_observed: 0,
    });
  });
});
