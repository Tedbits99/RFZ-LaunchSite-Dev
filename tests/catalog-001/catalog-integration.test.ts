import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minimumSalePriceCents } from '@/lib/catalogPricing';
import { importSupplierOffers, MOBILE_LEGENDS_CATEGORY_ID, validateSupplierOffers } from '@/lib/supplierCatalogImport';
import { identityDb, serviceDb } from '../../e2e/catalog-001/fixture-support';

const integration = describe.skipIf(process.env.CATALOG_INTEGRATION_RUN !== '1');
const runTag = `c001-${randomUUID().slice(0, 8)}`;
let supplierId = '';
let mobileLegendsGameId = '';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing disposable catalog integration value: ${name}`);
  return value;
}

function assertLoopback(name: string, value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a loopback URL.`); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`${name} refuses non-loopback hosts.`);
  return url;
}

async function gameFixture(label: string) {
  const slug = `${runTag}-${label}-${randomUUID().slice(0, 6)}`;
  const { data, error } = await serviceDb().from('games').insert({
    slug, name: `Synthetic ${label}`, description: 'Disposable CATALOG-001 integration fixture.',
    region: 'Synthetic Region', currency: 'PHP', is_active: false, is_featured: false,
    sort_order: 900, catalog_status: 'DRAFT',
  }).select('id,slug').single();
  if (error || !data) throw new Error(`Local game fixture failed (SQLSTATE ${error?.code || 'unknown'}).`);
  return data;
}

async function packageFixture(gameId: string, values: {
  sku?: string; name?: string; priceCents?: number; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; active?: boolean;
  offerId?: string | null; costUsd?: number | null; review?: boolean;
}) {
  const status = values.status || 'DRAFT';
  const offerId = values.offerId ?? null;
  const { data, error } = await serviceDb().from('packages').insert({
    game_id: gameId, name: values.name || 'Synthetic supplier package', amount: 'Synthetic amount',
    sku: values.sku || `${runTag}-${randomUUID()}`, price_cents: values.priceCents ?? 0,
    original_price_cents: null, is_active: values.active ?? status === 'PUBLISHED', catalog_status: status,
    published_at: status === 'PUBLISHED' ? new Date().toISOString() : null, sort_order: 1,
    supplier_offer_id: offerId, supplier_category_id: offerId ? MOBILE_LEGENDS_CATEGORY_ID : null,
    supplier_cost_usd: offerId ? values.costUsd ?? 1 : null,
    supplier_review_required: values.review ?? Boolean(offerId),
  }).select('id,game_id,sku,name,price_cents,is_active,catalog_status,supplier_offer_id,supplier_category_id,supplier_cost_usd,supplier_review_required').single();
  if (error || !data) throw new Error(`Local package fixture failed (SQLSTATE ${error?.code || 'unknown'}).`);
  return data;
}

async function linkOffer(packageId: string, offerId: string, costUsd = 1) {
  const { error } = await serviceDb().from('supplier_package_mappings').upsert({
    package_id: packageId, supplier_id: supplierId, supplier_product_id: offerId,
    supplier_cost_cents: Math.ceil(costUsd * 56 * 100), enabled: true,
    metadata: { category_id: MOBILE_LEGENDS_CATEGORY_ID },
  }, { onConflict: 'package_id,supplier_id' });
  if (error) throw new Error(`Local supplier mapping fixture failed (SQLSTATE ${error.code}).`);
}

async function adminCookie() {
  const url = assertLoopback('CATALOG_SUPABASE_URL', requiredEnv('CATALOG_SUPABASE_URL'));
  const client = createClient(url.toString(), requiredEnv('CATALOG_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email: requiredEnv('CATALOG_ADMIN_EMAIL'), password: requiredEnv('CATALOG_ADMIN_PASSWORD'),
  });
  if (error || !data.session) throw new Error('Synthetic admin could not authenticate to local Supabase Auth.');
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return `rfz-admin-auth=${value}`;
}

async function appRequest(path: string, body: Record<string, unknown>) {
  const origin = assertLoopback('CATALOG_APP_URL', requiredEnv('CATALOG_APP_URL'));
  if (origin.port !== '3000') throw new Error('CATALOG_APP_URL must use the isolated application port 3000.');
  const response = await fetch(new URL(path, origin), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: await adminCookie(), origin: origin.origin },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function importOffers(gameId: string, offers: Array<{ offer_id: string; name: string; price_usd: number }>, completeSnapshot = false) {
  return importSupplierOffers(serviceDb(), {
    gameId, supplierId, categoryId: MOBILE_LEGENDS_CATEGORY_ID, completeSnapshot,
    offers, fxRate: 56, feeReserveBps: 250, fixedFeeCents: 25,
  });
}

async function resetPricingAssumptions() {
  const { error } = await serviceDb().from('app_settings').update({
    reference_usd_php_rate: 56, payment_fee_reserve_bps: 250, payment_fee_fixed_cents: 25,
    supplier_fulfillment_release_enabled: false,
  }).eq('id', 1);
  if (error) throw new Error(`Local pricing fixture reset failed (SQLSTATE ${error.code}).`);
}

integration('CATALOG-001 disposable PostgreSQL/Auth integration contracts', () => {
  beforeAll(async () => {
    assertLoopback('CATALOG_SUPABASE_URL', requiredEnv('CATALOG_SUPABASE_URL'));
    const db = serviceDb();
    const { data: supplier, error: supplierError } = await db.from('suppliers').upsert({
      name: 'Synthetic FazerCards fixture', code: 'fazercards', adapter: 'fazercards',
      api_url: 'https://supplier.invalid', sandbox_api_url: 'https://supplier.invalid',
      environment: 'sandbox', enabled: false, auth_config: {}, metadata: { fixture: 'catalog-001' },
    }, { onConflict: 'code' }).select('id').single();
    if (supplierError || !supplier) throw new Error(`Local supplier fixture failed (SQLSTATE ${supplierError?.code || 'unknown'}).`);
    supplierId = supplier.id;
    const { data: existingGame, error: gameError } = await db.from('games').select('id').eq('slug', 'mobile-legends').maybeSingle();
    if (gameError) throw new Error(`Local catalog lookup failed (SQLSTATE ${gameError.code}).`);
    if (existingGame) mobileLegendsGameId = existingGame.id;
    else {
      const created = await gameFixture('mobile-legends');
      const renamed = await db.from('games').update({ slug: 'mobile-legends', name: 'Synthetic Mobile Legends' }).eq('id', created.id).select('id').single();
      if (renamed.error || !renamed.data) throw new Error('Could not create the expected local Mobile Legends fixture.');
      mobileLegendsGameId = renamed.data.id;
    }
    await resetPricingAssumptions();
  });

  beforeEach(async () => { await resetPricingAssumptions(); });
  afterEach(async () => { await resetPricingAssumptions(); });

  it('duplicate supplier offers are rejected before import and imports are idempotent', async () => {
    const offerId = `${runTag}-duplicate-${randomUUID().slice(0, 6)}`;
    const duplicate = validateSupplierOffers([
      { offer_id: offerId, name: 'Synthetic Duplicate', price_usd: 1 },
      { offer_id: offerId, name: 'Synthetic Duplicate Again', price_usd: 1 },
    ]);
    expect(duplicate.error).toMatch(/duplicate offer IDs/i);
    const parsed = validateSupplierOffers([{ offer_id: offerId, name: 'Synthetic Offer', price_usd: 1 }]);
    expect(parsed.error).toBeUndefined();
    const first = await importOffers(mobileLegendsGameId, parsed.offers!);
    const second = await importOffers(mobileLegendsGameId, parsed.offers!);
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 0 });
    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const { data, error } = await serviceDb().from('packages').select('id,is_active,catalog_status,price_cents').eq('supplier_offer_id', offerId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ is_active: false, catalog_status: 'DRAFT', price_cents: 0 });
  });

  it('a supplier SKU collision never converts a manually managed package', async () => {
    const offerId = `${runTag}-manual-collision-${randomUUID().slice(0, 6)}`;
    const sku = `FC-${MOBILE_LEGENDS_CATEGORY_ID}-${offerId}`;
    const manual = await packageFixture(mobileLegendsGameId, {
      sku, name: 'Manually Approved Synthetic Package', priceCents: 10_000, status: 'PUBLISHED', active: true,
    });
    const result = await importOffers(mobileLegendsGameId, [{ offer_id: offerId, name: 'Synthetic supplier offer', price_usd: 1 }]);
    expect(result.error).toMatch(/manual.*package/i);
    const { data, error } = await serviceDb().from('packages')
      .select('name,price_cents,is_active,catalog_status,supplier_offer_id,supplier_category_id')
      .eq('id', manual.id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      name: 'Manually Approved Synthetic Package', price_cents: 10_000, is_active: true,
      catalog_status: 'PUBLISHED', supplier_offer_id: null, supplier_category_id: null,
    });
  });

  it('existing package selling price and active state survive a supplier cost refresh', async () => {
    const offerId = `${runTag}-cost-refresh-${randomUUID().slice(0, 6)}`;
    const pkg = await packageFixture(mobileLegendsGameId, { offerId, costUsd: 1, priceCents: 10_000, status: 'PUBLISHED', active: true, review: false });
    await linkOffer(pkg.id, offerId, 1);
    const result = await importOffers(mobileLegendsGameId, [{ offer_id: offerId, name: 'Synthetic Updated Name', price_usd: 1.1 }]);
    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0, requires_review: 0 });
    const { data, error } = await serviceDb().from('packages').select('price_cents,is_active,catalog_status,supplier_cost_usd,supplier_review_required').eq('id', pkg.id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ price_cents: 10_000, is_active: true, catalog_status: 'PUBLISHED', supplier_review_required: false });
    expect(Number(data?.supplier_cost_usd)).toBeCloseTo(1.1);
  });

  it('removed upstream offers deactivate safely without deleting historical packages', async () => {
    const game = await gameFixture('historical-offer');
    const publishedGame = await serviceDb().from('games').update({
      is_active: true, catalog_status: 'PUBLISHED', published_at: new Date().toISOString(),
    }).eq('id', game.id);
    expect(publishedGame.error).toBeNull();
    const offerId = `${runTag}-removed-${randomUUID().slice(0, 6)}`;
    const pkg = await packageFixture(game.id, { sku: `${runTag}-history`, priceCents: 1000, status: 'PUBLISHED', active: true });
    const reference = `${runTag}-${randomUUID().slice(0, 8)}`;
    const insertedOrder = await serviceDb().from('orders').insert({
      reference, email: `${reference}@example.invalid`, customer_name: 'Synthetic historical customer',
      game_id: game.id, package_id: pkg.id,
      player_inputs: { player_id: 'synthetic', __rfz_order_access_hash: randomBytes(32).toString('hex') },
      subtotal_cents: 1000, discount_cents: 0, total_cents: 1000, payment_method: 'manual', status: 'WAITING_PAYMENT',
    }).select('id').single();
    expect(insertedOrder.error).toBeNull();
    const linked = await serviceDb().from('packages').update({ supplier_offer_id: offerId, supplier_category_id: MOBILE_LEGENDS_CATEGORY_ID, supplier_cost_usd: 1, supplier_review_required: false }).eq('id', pkg.id);
    expect(linked.error).toBeNull();
    await linkOffer(pkg.id, offerId, 1);
    const result = await importOffers(game.id, [{ offer_id: `${runTag}-retained-${randomUUID().slice(0, 6)}`, name: 'Synthetic current offer', price_usd: 1 }], true);
    expect(result).toMatchObject({ failed: 0, deactivated: 1 });
    const { data: savedPackage, error: packageError } = await serviceDb().from('packages').select('id,is_active,catalog_status,supplier_review_required').eq('id', pkg.id).single();
    const { data: savedOrder, error: orderError } = await serviceDb().from('orders').select('id,game_id,package_id').eq('id', insertedOrder.data!.id).single();
    expect(packageError).toBeNull();
    expect(orderError).toBeNull();
    expect(savedPackage).toMatchObject({ id: pkg.id, is_active: false, catalog_status: 'DRAFT', supplier_review_required: true });
    expect(savedOrder).toMatchObject({ id: insertedOrder.data!.id, game_id: game.id, package_id: pkg.id });
  });

  it('partial imports expose a recoverable result and never activate new packages', async () => {
    const game = await gameFixture('partial-import');
    const retainedOffer = `${runTag}-partial-retained-${randomUUID().slice(0, 6)}`;
    const retained = await packageFixture(game.id, { offerId: retainedOffer, costUsd: 1, priceCents: 10_000, status: 'PUBLISHED', active: true, review: false });
    await linkOffer(retained.id, retainedOffer, 1);
    const collisionOffer = `${runTag}-collision-${randomUUID().slice(0, 6)}`;
    const collisionSku = `FC-${MOBILE_LEGENDS_CATEGORY_ID}-${collisionOffer}`;
    const other = await gameFixture('sku-collision');
    const collision = await packageFixture(other.id, { sku: collisionSku, priceCents: 100, status: 'DRAFT', active: false });
    expect(collision.id).toBeTruthy();
    const successOffer = `${runTag}-partial-success-${randomUUID().slice(0, 6)}`;
    const result = await importOffers(game.id, [
      { offer_id: successOffer, name: 'Synthetic inserted before partial failure', price_usd: 1 },
      { offer_id: collisionOffer, name: 'Synthetic SKU collision', price_usd: 1 },
    ], true);
    expect(result).toMatchObject({ created: 1, failed: 1, deactivated: 0 });
    expect(result.failed_offer_ids).toEqual([collisionOffer]);
    const { data: imported, error } = await serviceDb().from('packages').select('id,is_active,catalog_status').eq('supplier_offer_id', successOffer).single();
    expect(error).toBeNull();
    expect(imported).toMatchObject({ is_active: false, catalog_status: 'DRAFT' });
    const { data: existing } = await serviceDb().from('packages').select('is_active,catalog_status').eq('id', retained.id).single();
    expect(existing).toMatchObject({ is_active: true, catalog_status: 'PUBLISHED' });
  });

  it('cross-game supplier mappings are rejected before catalog writes', async () => {
    const target = await gameFixture('cross-game-target');
    const other = await gameFixture('cross-game-owner');
    const offerId = `${runTag}-cross-game-${randomUUID().slice(0, 6)}`;
    const foreign = await packageFixture(other.id, { offerId, costUsd: 1, priceCents: 9000, status: 'DRAFT', active: false });
    await linkOffer(foreign.id, offerId, 1);
    const result = await importOffers(target.id, [{ offer_id: offerId, name: 'Synthetic foreign mapping', price_usd: 1 }]);
    expect(result.error).toMatch(/different game/i);
    const { data, error } = await serviceDb().from('packages').select('id').eq('game_id', target.id).eq('supplier_offer_id', offerId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('negative-margin packages cannot be published through the catalog API', async () => {
    const game = await gameFixture('negative-margin');
    const offerId = `${runTag}-negative-margin-${randomUUID().slice(0, 6)}`;
    const pkg = await packageFixture(game.id, { offerId, costUsd: 1, priceCents: 5500, status: 'DRAFT', active: false, review: false });
    const { response, body } = await appRequest(`/api/admin/catalog/packages/${pkg.id}`, { action: 'publish', price_cents: 5500 });
    expect(response.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toMatch(/supplier cost plus.*fee reserve/i);
    const { data } = await serviceDb().from('packages').select('is_active,catalog_status').eq('id', pkg.id).single();
    expect(data).toMatchObject({ is_active: false, catalog_status: 'DRAFT' });
  });

  it('payment fees are included in the approved pricing decision', async () => {
    const game = await gameFixture('payment-fee-reserve');
    const offerId = `${runTag}-fee-reserve-${randomUUID().slice(0, 6)}`;
    const pkg = await packageFixture(game.id, { offerId, costUsd: 1, priceCents: 5650, status: 'DRAFT', active: false, review: false });
    expect(minimumSalePriceCents(1, 56, 250, 25)).toBe(5770);
    const { response, body } = await appRequest(`/api/admin/catalog/packages/${pkg.id}`, { action: 'publish', price_cents: 5650 });
    expect(response.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toMatch(/fee reserve/i);
    const { data } = await serviceDb().from('packages').select('is_active,catalog_status').eq('id', pkg.id).single();
    expect(data).toMatchObject({ is_active: false, catalog_status: 'DRAFT' });
  });

  it('failed game-field replacement rolls back metadata and preserves the existing field set', async () => {
    const game = await gameFixture('atomic-field-failure');
    const { error: fieldError } = await serviceDb().from('game_input_fields').insert({
      game_id: game.id, label: 'Original Player ID', field_key: 'player_id', is_required: true, sort_order: 0,
    });
    expect(fieldError).toBeNull();
    const admin = await identityDb(requiredEnv('CATALOG_ADMIN_EMAIL'), requiredEnv('CATALOG_ADMIN_PASSWORD'));
    const result = await admin.rpc('admin_update_catalog_game', {
      p_id: game.id,
      p_updates: { name: 'Must Roll Back Together' },
      p_fields: [
        { label: 'Duplicate A', field_key: 'duplicate_id', is_required: true },
        { label: 'Duplicate B', field_key: 'duplicate_id', is_required: false },
      ],
    });
    expect(result.error).not.toBeNull();
    await admin.auth.signOut({ scope: 'local' });
    const { data: savedGame, error: savedGameError } = await serviceDb().from('games').select('name').eq('id', game.id).single();
    const { data: savedFields, error: savedFieldsError } = await serviceDb().from('game_input_fields').select('label,field_key,is_required').eq('game_id', game.id);
    expect(savedGameError).toBeNull();
    expect(savedFieldsError).toBeNull();
    expect(savedGame?.name).toBe('Synthetic atomic-field-failure');
    expect(savedFields).toEqual([{ label: 'Original Player ID', field_key: 'player_id', is_required: true }]);
  });

  it('concurrent field replacements serialize into one complete metadata-and-fields version', async () => {
    const game = await gameFixture('atomic-field-concurrency');
    const admin = await identityDb(requiredEnv('CATALOG_ADMIN_EMAIL'), requiredEnv('CATALOG_ADMIN_PASSWORD'));
    const first = admin.rpc('admin_update_catalog_game', {
      p_id: game.id,
      p_updates: { name: 'Concurrent Atomic Alpha' },
      p_fields: [{ label: 'Alpha ID', field_key: 'alpha_id', is_required: true }],
    });
    const second = admin.rpc('admin_update_catalog_game', {
      p_id: game.id,
      p_updates: { name: 'Concurrent Atomic Beta' },
      p_fields: [{ label: 'Beta ID', field_key: 'beta_id', is_required: true }],
    });
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.error)).toEqual([null, null]);
    await admin.auth.signOut({ scope: 'local' });
    const { data: savedGame, error: savedGameError } = await serviceDb().from('games').select('name').eq('id', game.id).single();
    const { data: savedFields, error: savedFieldsError } = await serviceDb().from('game_input_fields').select('field_key').eq('game_id', game.id);
    expect(savedGameError).toBeNull();
    expect(savedFieldsError).toBeNull();
    const finalKey = savedFields?.map((field) => field.field_key);
    if (savedGame?.name === 'Concurrent Atomic Alpha') expect(finalKey).toEqual(['alpha_id']);
    else {
      expect(savedGame?.name).toBe('Concurrent Atomic Beta');
      expect(finalKey).toEqual(['beta_id']);
    }
  });

  it('FX changes require explicit review and never silently rewrite approved prices', async () => {
    const game = await gameFixture('fx-review');
    const offerId = `${runTag}-fx-review-${randomUUID().slice(0, 6)}`;
    const pkg = await packageFixture(game.id, { offerId, costUsd: 1, priceCents: 10_000, status: 'PUBLISHED', active: true, review: false });
    const { response, body } = await appRequest('/api/admin/settings', { reference_usd_php_rate: 57 });
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ success: true, recalculated: 0 });
    const { data, error } = await serviceDb().from('packages').select('price_cents,is_active,catalog_status,supplier_review_required').eq('id', pkg.id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ price_cents: 10_000, is_active: false, catalog_status: 'DRAFT', supplier_review_required: true });
  });

  it('staff identities cannot bypass catalog APIs with direct table writes', async () => {
    const game = await gameFixture('staff-dml-boundary');
    const pkg = await packageFixture(game.id, { sku: `${runTag}-staff-package`, priceCents: 100, status: 'DRAFT', active: false });
    const staff = await identityDb(requiredEnv('CATALOG_STAFF_EMAIL'), requiredEnv('CATALOG_STAFF_PASSWORD'));
    const gameUpdate = await staff.from('games').update({ name: 'Forbidden staff edit' }).eq('id', game.id).select('id');
    const packageUpdate = await staff.from('packages').update({ price_cents: 1 }).eq('id', pkg.id).select('id');
    const fieldInsert = await staff.from('game_input_fields').insert({ game_id: game.id, label: 'Forbidden', field_key: `staff_${runTag.replace(/-/g, '_')}` }).select('id');
    const rpc = await staff.rpc('admin_create_catalog_game', {
      p_game: { slug: `${runTag}-staff-rpc`, name: 'Forbidden staff RPC', region: 'Synthetic' }, p_fields: [],
    });
    expect(gameUpdate.error).not.toBeNull();
    expect(packageUpdate.error).not.toBeNull();
    expect(fieldInsert.error).not.toBeNull();
    expect(rpc.error).not.toBeNull();
    await staff.auth.signOut({ scope: 'local' });
    const { data: savedGame } = await serviceDb().from('games').select('name').eq('id', game.id).single();
    const { data: savedPackage } = await serviceDb().from('packages').select('price_cents').eq('id', pkg.id).single();
    expect(savedGame?.name).toBe('Synthetic staff-dml-boundary');
    expect(savedPackage?.price_cents).toBe(100);
  });

  it('supplier outage paths remain closed and do not contact a provider', async () => {
    const response = await fetch(new URL('/api/admin/sync-offers', assertLoopback('CATALOG_APP_URL', requiredEnv('CATALOG_APP_URL'))), {
      method: 'POST', headers: { cookie: await adminCookie(), origin: requiredEnv('CATALOG_APP_URL') },
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(503);
    expect(body).toMatchObject({ error: expect.stringMatching(/disabled|not available|release/i) });
  });
});
