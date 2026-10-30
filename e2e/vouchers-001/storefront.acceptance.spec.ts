import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceDb, writeEvidence } from '../catalog-001/fixture-support';

const packageId = 'c0010000-0000-4000-8000-000000000022';

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': '198.51.100.111' });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
});

test('storefront lists and applies one public offer with authoritative price and dates', async ({ page }, testInfo) => {
  const db = serviceDb();
  const [{ data: admin, error: adminError }, { data: pkg, error: packageError }] = await Promise.all([
    db.from('admins').select('id').eq('email', process.env.CATALOG_ADMIN_EMAIL || '').single(),
    db.from('packages').select('id,price_cents,catalog_status,is_active').eq('id', packageId).single(),
  ]);
  expect(adminError).toBeNull();
  expect(packageError).toBeNull();
  expect(pkg).toMatchObject({ price_cents: 400, catalog_status: 'PUBLISHED', is_active: true });

  const code = `PUB-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: campaignRows, error: campaignError } = await db.rpc('admin_create_promotion_campaign', {
    p_actor_id: admin!.id,
    p_data: {
      name: `Synthetic Public ${testInfo.project.name}`,
      description: 'Disposable public storefront offer.',
      campaign_type: 'PUBLIC_PROMOTION',
      code,
      discount_type: 'FIXED',
      discount_value: 75,
      min_order_cents: 0,
      max_discount_cents: null,
      total_redemption_limit: 10,
      per_customer_redemption_limit: 1,
      discount_budget_cents: 750,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      timezone: 'UTC',
      eligibility_rules: { allow_guest: true },
      public_discovery: true,
      game_ids: [],
      package_ids: [packageId],
    },
  });
  expect(campaignError).toBeNull();
  expect(campaignRows).toHaveLength(1);
  const campaignId = campaignRows[0].out_campaign_id as string;
  const { data: active, error: activateError } = await db.rpc('admin_transition_promotion_campaign', {
    p_actor_id: admin!.id, p_campaign_id: campaignId, p_next_status: 'ACTIVE',
  });
  expect(activateError).toBeNull();
  expect(active?.[0]?.out_status).toBe('ACTIVE');

  await page.goto('/games/catalog-001-seed-published');
  await page.getByLabel('Email Address').fill(`buyer-${testInfo.project.name}@example.invalid`);
  const publicOffers = page.getByLabel('Eligible public promotions');
  await expect(publicOffers).toContainText('Available for this package');
  await expect(publicOffers).toContainText(code);
  await expect(publicOffers).toContainText('₱4.00 − ₱0.75 = ₱3.25');
  await expect(publicOffers).toContainText('Valid through');
  await expect(publicOffers).toContainText('(UTC)');
  const targetedOffer = publicOffers.getByText(code, { exact: true }).locator('xpath=../../..');
  await targetedOffer.getByRole('button', { name: 'Apply offer' }).click();

  const voucher = page.getByText(`${code} applied`, { exact: true });
  await expect(voucher).toBeVisible();
  await expect(page.getByText('₱4.00 − ₱0.75 = ₱3.25')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(voucher).toHaveCount(0);
  await expect(publicOffers).toContainText(code);

  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  await writeEvidence(page, testInfo, {
    action: 'public_offer_price_and_schedule',
    package_id: packageId,
    subtotal_cents: 400,
    discount_cents: 75,
    total_cents: 325,
    private_code_discovery: false,
    no_checkout_submitted: true,
    ...dimensions,
  });
});
