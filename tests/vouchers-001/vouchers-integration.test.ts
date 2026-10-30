import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { anonDb, identityDb, serviceDb } from '../../e2e/catalog-001/fixture-support';

const integration = describe.skipIf(process.env.VOUCHERS_INTEGRATION_RUN !== '1');
const packageId = 'c0010000-0000-4000-8000-000000000022';
const gameId = 'c0010000-0000-4000-8000-000000000002';
const runTag = `v001-${randomUUID().slice(0, 8)}`;
let otherPackageId = '';
let adminId = '';
let cachedAdminCookie = '';
let cachedStaffCookie = '';
let cachedCustomerCookie = '';

type ResponseBody = Record<string, unknown> & { data?: unknown; reference?: string };

function responseData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function orderReference(body: ResponseBody): string {
  if (typeof body.reference !== 'string') throw new Error('Synthetic order did not return a reference.');
  return body.reference;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing disposable voucher integration value: ${name}`);
  return value;
}

async function clearDisposableVoucherRateBuckets() {
  const connection = new URL(requiredEnv('CATALOG_LOCAL_DB_URL'));
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)
      || connection.hostname !== '127.0.0.1'
      || connection.port !== process.env.E2E_LOCAL_DB_PORT) {
    throw new Error('Voucher rate-limit reset refuses a non-loopback disposable database.');
  }
  const sql = postgres(connection.toString(), { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await sql`DELETE FROM voucher_private.rate_limit_buckets`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function localOrigin(): URL {
  const value = requiredEnv('CATALOG_APP_URL');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '3000') {
    throw new Error('Voucher acceptance refuses a non-loopback app origin.');
  }
  return url;
}

function localSupabaseUrl(): string {
  const url = new URL(requiredEnv('CATALOG_SUPABASE_URL'));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== process.env.CATALOG_LOCAL_API_PORT) {
    throw new Error('Voucher acceptance refuses a non-loopback Supabase origin.');
  }
  return url.origin;
}

function sessionCookie(session: unknown, name: string): string {
  return `${name}=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

async function authCookie(kind: 'ADMIN' | 'STAFF' | 'CUSTOMER'): Promise<string> {
  if (kind === 'ADMIN' && cachedAdminCookie) return cachedAdminCookie;
  if (kind === 'STAFF' && cachedStaffCookie) return cachedStaffCookie;
  if (kind === 'CUSTOMER' && cachedCustomerCookie) return cachedCustomerCookie;
  const suffix = kind === 'ADMIN' ? 'ADMIN' : kind === 'STAFF' ? 'STAFF' : 'CUSTOMER';
  const identity = await identityDb(requiredEnv(`CATALOG_${suffix}_EMAIL`), requiredEnv(`CATALOG_${suffix}_PASSWORD`));
  const { data: { session } } = await identity.auth.getSession();
  if (!session) throw new Error(`Synthetic ${kind.toLowerCase()} session was not created.`);
  const value = sessionCookie(session, kind === 'CUSTOMER' ? 'rfz-customer-auth' : 'rfz-admin-auth');
  if (kind === 'ADMIN') cachedAdminCookie = value;
  else if (kind === 'STAFF') cachedStaffCookie = value;
  else cachedCustomerCookie = value;
  return value;
}

async function appRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: Record<string, unknown>,
  options: { cookie?: string | null; ip?: string } = {},
) {
  const headers = new Headers({ origin: localOrigin().origin });
  if (method !== 'GET') headers.set('content-type', 'application/json');
  if (options.cookie === undefined) headers.set('cookie', await authCookie('ADMIN'));
  else if (options.cookie !== null) headers.set('cookie', options.cookie);
  if (options.ip) headers.set('cf-connecting-ip', options.ip);
  const response = await fetch(new URL(path, localOrigin()), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });
  return { response, body: await response.json().catch(() => ({})) as ResponseBody };
}

function campaignPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: `Synthetic ${runTag} campaign`,
    description: 'Disposable VOUCHERS-001 contract fixture.',
    campaign_type: 'PRIVATE_CODE',
    code: `VCH-${randomUUID().slice(0, 8).toUpperCase()}`,
    discount_type: 'FIXED',
    discount_value: 50,
    min_order_cents: 0,
    max_discount_cents: null,
    total_redemption_limit: 10,
    per_customer_redemption_limit: 1,
    discount_budget_cents: 500,
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    timezone: 'UTC',
    eligibility_rules: { allow_guest: true },
    public_discovery: false,
    game_ids: [],
    package_ids: [],
    ...overrides,
  };
}

async function createCampaign(overrides: Record<string, unknown> = {}) {
  const payload = campaignPayload(overrides);
  const { response, body } = await appRequest('/api/admin/vouchers/campaigns', 'POST', payload);
  const data = responseData(body.data);
  if (!response.ok || typeof data?.out_campaign_id !== 'string' || typeof data.out_voucher_id !== 'string') {
    throw new Error(`Synthetic campaign creation failed (HTTP ${response.status}).`);
  }
  return { id: data.out_campaign_id, voucherId: data.out_voucher_id, payload };
}

async function campaignStatus(id: string, status: string) {
  return appRequest('/api/admin/vouchers/campaigns', 'PATCH', { action: 'status', id, status });
}

async function validateCode(code: string, targetPackage = packageId, options: { cookie?: string | null; ip?: string; email?: string } = {}) {
  return appRequest('/api/vouchers/validate', 'POST', {
    code, packageId: targetPackage, email: options.email || `buyer-${runTag}@example.invalid`,
  }, { cookie: options.cookie, ip: options.ip || '198.51.100.70' });
}

async function createOrder(code: string, suffix: string, key = randomUUID()) {
  return appRequest('/api/orders', 'POST', {
    gameId,
    packageId,
    email: `${runTag}-${suffix}@example.invalid`,
    name: 'Synthetic voucher checkout',
    playerInputs: { player_id: 'synthetic-player-id' },
    paymentMethod: 'manual',
    voucherCode: code,
    idempotencyKey: key,
  }, { cookie: null });
}

integration('VOUCHERS-001 disposable PostgreSQL 17/Auth acceptance', () => {
  beforeAll(async () => {
    localSupabaseUrl();
    const db = serviceDb();
    const [{ data: pkg, error: packageError }, { data: game, error: gameError }, { data: admin, error: adminError }] = await Promise.all([
      db.from('packages').select('id,game_id,is_active,catalog_status,price_cents').eq('id', packageId).single(),
      db.from('games').select('id,is_active,catalog_status').eq('id', gameId).single(),
      db.from('admins').select('id').eq('email', requiredEnv('CATALOG_ADMIN_EMAIL')).single(),
    ]);
    if (packageError || !pkg || gameError || !game || adminError || !admin) {
      throw new Error('Deterministic published game/package/admin fixtures are unavailable.');
    }
    if (pkg.game_id !== game.id || !pkg.is_active || pkg.catalog_status !== 'PUBLISHED'
        || !game.is_active || game.catalog_status !== 'PUBLISHED' || Number(pkg.price_cents) <= 50) {
      throw new Error('Voucher fixture product is not a saleable synthetic catalog item.');
    }
    adminId = admin.id;
    const candidate = await db.from('packages').insert({
      game_id: gameId,
      name: `Synthetic target package ${runTag}`,
      amount: 'Synthetic target package',
      sku: `${runTag}-TARGET`,
      price_cents: 800,
      is_active: true,
      catalog_status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      sort_order: 999,
      supplier_offer_id: null,
      supplier_category_id: null,
      supplier_cost_usd: null,
      supplier_review_required: false,
    }).select('id').single();
    if (candidate.error || !candidate.data) throw new Error(`Synthetic alternate package fixture failed (SQLSTATE ${candidate.error?.code || 'unknown'}).`);
    otherPackageId = candidate.data.id;
    const { data: settings, error: settingsError } = await db.from('app_settings')
      .select('supplier_fulfillment_release_enabled').eq('id', 1).single();
    if (settingsError || settings.supplier_fulfillment_release_enabled !== false) {
      throw new Error('The disposable supplier fulfillment release lock must remain off.');
    }
  });

  it('creates, edits, lists, archives and reports campaigns; rejects duplicate codes and unauthorized roles', async () => {
    const draft = await createCampaign({ code: `VCH-${randomUUID().slice(0, 8).toUpperCase()}` });
    const list = await appRequest('/api/admin/vouchers/campaigns');
    expect(list.response.status).toBe(200);
    expect(list.body.data).toEqual(expect.arrayContaining([expect.objectContaining({
      id: draft.id, stored_status: 'DRAFT', code: draft.payload.code,
    })]));

    const edited = { ...draft.payload, name: `Edited ${draft.payload.name}`, description: 'Persisted by the authorized campaign API.' };
    const update = await appRequest('/api/admin/vouchers/campaigns', 'PATCH', { id: draft.id, ...edited });
    expect(update.response.status).toBe(200);
    const duplicate = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload({ code: draft.payload.code.toLowerCase() }));
    expect(duplicate.response.status).toBe(409);

    const staff = await authCookie('STAFF');
    const denied = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload(), { cookie: staff });
    expect(denied.response.status).toBe(403);
    const anonymous = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload(), { cookie: null });
    expect([401, 403]).toContain(anonymous.response.status);

    const active = await campaignStatus(draft.id, 'ACTIVE');
    expect(active.response.status).toBe(200);
    const pause = await campaignStatus(draft.id, 'PAUSED');
    expect(pause.response.status).toBe(200);
    const archive = await campaignStatus(draft.id, 'ARCHIVED');
    expect(archive.response.status).toBe(200);
    const report = await appRequest(`/api/admin/vouchers/campaigns/${draft.id}/report?limit=500`);
    expect(report.response.status).toBe(200);
    expect(responseData(report.body.data)?.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'STATUS_CHANGED' })]));
    expect(JSON.stringify(report.body)).not.toContain('@example.invalid');
  });

  it('enforces package targeting, public-only discovery, scheduling, expiry and pause state', async () => {
    const publicCampaign = await createCampaign({
      campaign_type: 'PUBLIC_PROMOTION', public_discovery: true,
      package_ids: [packageId], code: `PUB-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    const privateCampaign = await createCampaign({
      campaign_type: 'PACKAGE_SPECIFIC', package_ids: [packageId],
      code: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(publicCampaign.id, 'ACTIVE')).response.status).toBe(200);
    expect((await campaignStatus(privateCampaign.id, 'ACTIVE')).response.status).toBe(200);

    const offers = await appRequest('/api/promotions/available', 'POST', {
      packageId, email: `public-${runTag}@example.invalid`,
    }, { cookie: null });
    expect(offers.response.status).toBe(200);
    expect(offers.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ code: publicCampaign.payload.code })]));
    expect(JSON.stringify(offers.body)).not.toContain(privateCampaign.payload.code);

    const valid = await validateCode(publicCampaign.payload.code as string);
    expect(valid.response.status).toBe(200);
    expect(valid.body).toMatchObject({ success: true, discount: 50, total: expect.any(Number) });
    const directAnonymous = await anonDb().rpc('validate_campaign_voucher', {
      p_code: privateCampaign.payload.code as string, p_package_id: packageId, p_email: `direct-${runTag}@example.invalid`,
    });
    expect(directAnonymous.error).not.toBeNull();
    expect(directAnonymous.data).toBeNull();
    const wrongPackage = await validateCode(privateCampaign.payload.code as string, otherPackageId);
    expect(wrongPackage.response.status).toBe(400);

    const paused = await campaignStatus(privateCampaign.id, 'PAUSED');
    expect(paused.response.status).toBe(200);
    const deniedPaused = await validateCode(privateCampaign.payload.code as string);
    expect(deniedPaused.response.status).toBe(400);

    const futureStart = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await createCampaign({ starts_at: futureStart, code: `SCH-${randomUUID().slice(0, 8).toUpperCase()}` });
    const scheduledStatus = await campaignStatus(scheduled.id, 'ACTIVE');
    expect(scheduledStatus.response.status).toBe(200);
    expect(responseData(scheduledStatus.body.data)?.out_status).toBe('SCHEDULED');
    const notYetStarted = await validateCode(scheduled.payload.code as string);
    expect(notYetStarted.response.status).toBe(400);

    const expiring = await createCampaign({
      starts_at: new Date(Date.now() - 5_000).toISOString(),
      ends_at: new Date(Date.now() + 5_000).toISOString(),
      code: `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(expiring.id, 'ACTIVE')).response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    expect((await validateCode(expiring.payload.code as string)).response.status).toBe(400);
  }, 30_000);

  it('requires verified account identity for first-purchase campaigns and rejects invalid rule payloads', async () => {
    const welcome = await createCampaign({
      campaign_type: 'WELCOME', eligibility_rules: { allow_guest: false, require_authenticated: true },
      code: `WEL-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(welcome.id, 'ACTIVE')).response.status).toBe(200);
    const guest = await validateCode(welcome.payload.code as string);
    expect(guest.response.status).toBe(400);
    const forgedGuest = await appRequest('/api/vouchers/validate', 'POST', {
      code: welcome.payload.code, packageId, email: requiredEnv('CATALOG_CUSTOMER_EMAIL'),
      customerUserId: 'c0010000-0000-4000-8000-000000000099',
    }, { cookie: null, ip: '198.51.100.73' });
    expect(forgedGuest.response.status).toBe(400);
    const customer = await validateCode(welcome.payload.code as string, packageId, {
      cookie: await authCookie('CUSTOMER'), email: requiredEnv('CATALOG_CUSTOMER_EMAIL'), ip: '198.51.100.74',
    });
    expect(customer.response.status).toBe(200);

    const customerClient = await identityDb(requiredEnv('CATALOG_CUSTOMER_EMAIL'), requiredEnv('CATALOG_CUSTOMER_PASSWORD'));
    const { data: customerUser } = await customerClient.auth.getUser();
    if (!customerUser.user) throw new Error('Synthetic welcome customer identity is missing.');
    const directRpc = await customerClient.rpc('validate_campaign_voucher', {
      p_code: welcome.payload.code as string, p_package_id: packageId, p_email: 'forged@example.invalid',
    });
    expect(directRpc.error).not.toBeNull();
    const forgedServerRpc = await anonDb().rpc('validate_campaign_voucher_for_server', {
      p_code: welcome.payload.code as string, p_package_id: packageId,
      p_email: requiredEnv('CATALOG_CUSTOMER_EMAIL'), p_customer_user_id: customerUser.user.id,
    });
    expect(forgedServerRpc.error).not.toBeNull();

    const customerOrder = await appRequest('/api/orders', 'POST', {
      gameId, packageId, email: 'browser-supplied@example.invalid', name: 'Synthetic verified customer',
      playerInputs: { player_id: 'synthetic-customer-player' }, paymentMethod: 'manual',
      voucherCode: welcome.payload.code, idempotencyKey: randomUUID(),
    }, { cookie: await authCookie('CUSTOMER') });
    expect(customerOrder.response.status).toBe(200);
    const { data: customerOrderRecord, error: customerOrderError } = await serviceDb().from('orders')
      .select('customer_user_id,email,voucher_code').eq('reference', orderReference(customerOrder.body)).single();
    expect(customerOrderError).toBeNull();
    expect(customerOrderRecord).toMatchObject({
      customer_user_id: customerUser.user.id,
      email: requiredEnv('CATALOG_CUSTOMER_EMAIL'),
      voucher_code: welcome.payload.code,
    });

    const superAdminEmail = `voucher-super-${runTag}@example.invalid`;
    const superAdminPassword = randomUUID();
    const { data: createdSuperAdmin, error: createSuperAdminError } = await serviceDb().auth.admin.createUser({
      email: superAdminEmail,
      password: superAdminPassword,
      email_confirm: true,
    });
    if (createSuperAdminError || !createdSuperAdmin.user) {
      throw new Error('Synthetic voucher super-admin identity could not be created.');
    }
    const { error: insertSuperAdminError } = await serviceDb().from('admins').insert({
      id: createdSuperAdmin.user.id,
      email: superAdminEmail,
      name: 'Synthetic Voucher Super Admin',
      role: 'SUPER_ADMIN',
      is_active: true,
    });
    if (insertSuperAdminError) throw new Error('Synthetic voucher super-admin authorization could not be created.');
    const superAdmin = await identityDb(superAdminEmail, superAdminPassword);
    let profileRestored = false;
    try {
      const suspended = await superAdmin.rpc('admin_set_customer_profile_status', {
        p_user_id: customerUser.user.id,
        p_status: 'suspended',
      });
      const suspendedRow = responseData(Array.isArray(suspended.data) ? suspended.data[0] : suspended.data);
      expect(suspended.error).toBeNull();
      expect(suspendedRow?.out_status).toBe('suspended');
      expect(suspendedRow?.out_error).toBeNull();

      const directDenied = await customerClient.rpc('validate_campaign_voucher', {
        p_code: welcome.payload.code as string, p_package_id: packageId, p_email: 'forged@example.invalid',
      });
      expect(directDenied.error).not.toBeNull();
      const routeDenied = await validateCode(welcome.payload.code as string, packageId, {
        cookie: await authCookie('CUSTOMER'), email: requiredEnv('CATALOG_CUSTOMER_EMAIL'), ip: '198.51.100.76',
      });
      expect(routeDenied.response.status).toBe(403);
    } finally {
      const restored = await superAdmin.rpc('admin_set_customer_profile_status', {
        p_user_id: customerUser.user.id,
        p_status: 'active',
      });
      const restoredRow = responseData(Array.isArray(restored.data) ? restored.data[0] : restored.data);
      profileRestored = restored.error === null
        && restoredRow?.out_status === 'active'
        && restoredRow?.out_error === null;
    }
    expect(profileRestored).toBe(true);

    const badDiscount = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload({ discount_value: 0 }));
    expect(badDiscount.response.status).toBe(400);
    const badLimitedCampaign = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload({
      campaign_type: 'LIMITED_REDEMPTION', total_redemption_limit: null, per_customer_redemption_limit: null,
    }));
    expect(badLimitedCampaign.response.status).toBe(400);
    const badTimezone = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload({ timezone: 'Mars/Olympus' }));
    expect(badTimezone.response.status).toBe(400);
    const badSchedule = await appRequest('/api/admin/vouchers/campaigns', 'POST', campaignPayload({
      starts_at: '2026-10-30T14:00:00',
    }));
    expect(badSchedule.response.status).toBe(400);
  });

  it('allows eligible returning accounts but not guest identities to use retention offers', async () => {
    const customer = await identityDb(requiredEnv('CATALOG_CUSTOMER_EMAIL'), requiredEnv('CATALOG_CUSTOMER_PASSWORD'));
    const { data: { user } } = await customer.auth.getUser();
    if (!user) throw new Error('Synthetic returning customer session was not established.');
    const historicalOrder = await appRequest('/api/orders', 'POST', {
      gameId,
      packageId,
      email: requiredEnv('CATALOG_CUSTOMER_EMAIL'),
      name: 'Synthetic retention fixture',
      playerInputs: { player_id: 'synthetic-retention-player' },
      paymentMethod: 'manual',
      idempotencyKey: randomUUID(),
    }, { cookie: await authCookie('CUSTOMER') });
    expect(historicalOrder.response.status).toBe(200);
    const { error: completionError } = await serviceDb().from('orders').update({
      status: 'COMPLETED', payment_status: 'VERIFIED', updated_at: new Date().toISOString(),
    }).eq('reference', orderReference(historicalOrder.body)).eq('customer_user_id', user.id);
    expect(completionError).toBeNull();

    const retention = await createCampaign({
      campaign_type: 'CUSTOMER_RETENTION',
      eligibility_rules: { allow_guest: false, require_authenticated: true, min_completed_orders: 1 },
      code: `RET-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(retention.id, 'ACTIVE')).response.status).toBe(200);
    const guest = await validateCode(retention.payload.code as string);
    expect(guest.response.status).toBe(400);
    const returning = await validateCode(retention.payload.code as string, packageId, {
      cookie: await authCookie('CUSTOMER'), email: requiredEnv('CATALOG_CUSTOMER_EMAIL'), ip: '198.51.100.75',
    });
    expect(returning.response.status).toBe(200);
    expect(returning.body).toMatchObject({ success: true, discount: 50, total: 350 });
  });

  it('serializes 50 concurrent redemptions to exactly the 10-use and budget caps', async () => {
    const campaign = await createCampaign({
      total_redemption_limit: 10,
      per_customer_redemption_limit: 1,
      discount_budget_cents: 500,
      code: `CON-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(campaign.id, 'ACTIVE')).response.status).toBe(200);
    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => createOrder(campaign.payload.code as string, `concurrent-${index}`)));
    const successful = responses.filter(({ response, body }) => response.ok && typeof body.reference === 'string');
    const rejected = responses.filter(({ response }) => !response.ok);
    expect(successful).toHaveLength(10);
    expect(rejected).toHaveLength(40);
    expect(rejected.every(({ body }) => /redemption limit/i.test(String(body.error)))).toBe(true);

    const { data: usages, error } = await serviceDb().from('voucher_usages')
      .select('id,redemption_status,discount_cents').eq('campaign_id', campaign.id);
    expect(error).toBeNull();
    expect(usages).toHaveLength(10);
    expect(usages?.every((usage) => usage.redemption_status === 'RESERVED')).toBe(true);
    expect(usages?.reduce((sum, usage) => sum + usage.discount_cents, 0)).toBe(500);
    const listed = await appRequest('/api/admin/vouchers/campaigns');
    const summary = (Array.isArray(listed.body.data) ? listed.body.data as Record<string, unknown>[] : [])
      .find((item) => item.id === campaign.id);
    expect(summary).toMatchObject({ reserved_uses: 10, active_discount_cents: 500, remaining_budget_cents: 0 });
  });

  it('recovers retries idempotently and releases one cancellation exactly once', async () => {
    const campaign = await createCampaign({
      total_redemption_limit: 2, per_customer_redemption_limit: 1, discount_budget_cents: 500,
      code: `IDM-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
    expect((await campaignStatus(campaign.id, 'ACTIVE')).response.status).toBe(200);
    const key = randomUUID();
    const first = await createOrder(campaign.payload.code as string, 'idempotent', key);
    const retry = await createOrder(campaign.payload.code as string, 'idempotent', key);
    expect(first.response.status).toBe(200);
    expect(retry.response.status).toBe(200);
    expect(orderReference(retry.body)).toBe(orderReference(first.body));
    const db = serviceDb();
    const { data: retryOrders, error: retryOrdersError } = await db.from('orders')
      .select('id').eq('reference', orderReference(first.body));
    expect(retryOrdersError).toBeNull();
    expect(retryOrders).toHaveLength(1);
    const { data: retryUses, error: retryUsesError } = await db.from('voucher_usages')
      .select('id').eq('campaign_id', campaign.id);
    expect(retryUsesError).toBeNull();
    expect(retryUses).toHaveLength(1);
    const changedPayload = await appRequest('/api/orders', 'POST', {
      gameId, packageId, email: `${runTag}-different@example.invalid`, name: 'Synthetic voucher checkout',
      playerInputs: { player_id: 'synthetic-player-id' }, paymentMethod: 'manual',
      voucherCode: campaign.payload.code, idempotencyKey: key,
    }, { cookie: null });
    expect(changedPayload.response.status).toBe(409);

    const { data: order, error: orderError } = await db.from('orders').select('id').eq('reference', orderReference(first.body)).single();
    expect(orderError).toBeNull();
    expect(order).not.toBeNull();
    if (!order) throw new Error('Synthetic idempotent order was not persisted.');
    const cancel = await appRequest(`/api/admin/orders/${order.id}/status`, 'PATCH', { status: 'CANCELLED', note: 'Synthetic cancellation release test.' });
    expect(cancel.response.status).toBe(200);
    const { data: usage, error: usageError } = await db.from('voucher_usages')
      .select('redemption_status,released_at,release_reason').eq('campaign_id', campaign.id).single();
    expect(usageError).toBeNull();
    expect(usage).toMatchObject({ redemption_status: 'RELEASED', release_reason: 'ORDER_CANCELLED' });
    const repeatedCancel = await db.from('orders').update({ status: 'CANCELLED' }).eq('id', order.id);
    expect(repeatedCancel.error).toBeNull();
    const { data: stillReleased } = await db.from('voucher_usages')
      .select('redemption_status,released_at,release_reason').eq('campaign_id', campaign.id).single();
    expect(stillReleased).toMatchObject({ redemption_status: 'RELEASED', release_reason: 'ORDER_CANCELLED' });
    const retryAfterRelease = await createOrder(campaign.payload.code as string, 'idempotent', randomUUID());
    expect(retryAfterRelease.response.status).toBe(200);
    const { data: rows } = await db.from('voucher_usages').select('redemption_status').eq('campaign_id', campaign.id);
    expect(rows?.filter((row) => row.redemption_status === 'RELEASED')).toHaveLength(1);
    expect(rows?.filter((row) => row.redemption_status === 'RESERVED')).toHaveLength(1);
  });

  it('releases failed and timed-out orders only through the existing terminal order lifecycle', async () => {
    const failedCampaign = await createCampaign({ code: `FLD-${randomUUID().slice(0, 8).toUpperCase()}` });
    expect((await campaignStatus(failedCampaign.id, 'ACTIVE')).response.status).toBe(200);
    const failedOrder = await createOrder(failedCampaign.payload.code as string, 'failed', randomUUID());
    expect(failedOrder.response.status).toBe(200);
    const db = serviceDb();
    const { data: failedRecord } = await db.from('orders').select('id').eq('reference', orderReference(failedOrder.body)).single();
    const failUpdate = await db.from('orders').update({ payment_status: 'FAILED' }).eq('id', failedRecord!.id);
    expect(failUpdate.error).toBeNull();
    const { data: failedUsage } = await db.from('voucher_usages').select('redemption_status,release_reason').eq('campaign_id', failedCampaign.id).single();
    expect(failedUsage).toMatchObject({ redemption_status: 'RELEASED', release_reason: 'PAYMENT_FAILED' });

    const timeoutCampaign = await createCampaign({ code: `TMO-${randomUUID().slice(0, 8).toUpperCase()}` });
    expect((await campaignStatus(timeoutCampaign.id, 'ACTIVE')).response.status).toBe(200);
    const timeoutOrder = await createOrder(timeoutCampaign.payload.code as string, 'timeout', randomUUID());
    expect(timeoutOrder.response.status).toBe(200);
    const { data: timeoutRecord } = await db.from('orders').select('id').eq('reference', orderReference(timeoutOrder.body)).single();
    const backdate = await db.from('orders').update({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }).eq('id', timeoutRecord!.id);
    expect(backdate.error).toBeNull();
    const archived = await db.rpc('archive_old_unpaid_orders');
    expect(archived.error).toBeNull();
    const { data: expired } = await db.from('orders').select('status,is_archived').eq('id', timeoutRecord!.id).single();
    const { data: timeoutUsage } = await db.from('voucher_usages').select('redemption_status,release_reason').eq('campaign_id', timeoutCampaign.id).single();
    expect(expired).toMatchObject({ status: 'EXPIRED', is_archived: true });
    expect(timeoutUsage).toMatchObject({ redemption_status: 'RELEASED', release_reason: 'ORDER_EXPIRED' });
  });

  it('keeps public roles out of campaign tables and refuses supplier-linked offers while the release lock is off', async () => {
    const anonymous = anonDb();
    const tableRead = await anonymous.from('promotion_campaigns').select('id').limit(1);
    expect(tableRead.error).not.toBeNull();
    const anonymousVoucherRead = await anonymous.from('vouchers').select('id,code').limit(1);
    const anonymousUsageRead = await anonymous.from('voucher_usages').select('id').limit(1);
    expect(anonymousVoucherRead.error).not.toBeNull();
    expect(anonymousUsageRead.error).not.toBeNull();
    const customer = await identityDb(requiredEnv('CATALOG_CUSTOMER_EMAIL'), requiredEnv('CATALOG_CUSTOMER_PASSWORD'));
    const customerRead = await customer.from('promotion_campaigns').select('id').limit(1);
    expect(customerRead.error).not.toBeNull();
    const customerVoucherRead = await customer.from('vouchers').select('id,code').limit(1);
    const customerUsageRead = await customer.from('voucher_usages').select('id').limit(1);
    expect(customerVoucherRead.error).not.toBeNull();
    expect(customerUsageRead.error).not.toBeNull();
    const directMutation = await anonymous.rpc('admin_create_promotion_campaign', {
      p_actor_id: adminId, p_data: campaignPayload(),
    });
    expect(directMutation.error).not.toBeNull();

    const db = serviceDb();
    const linked = await db.from('packages').insert({
      game_id: gameId, name: `Synthetic supplier-linked ${runTag}`, amount: 'Synthetic', sku: `${runTag}-SUPPLIER`,
      price_cents: 1000, is_active: true, catalog_status: 'PUBLISHED', published_at: new Date().toISOString(),
      sort_order: 1000, supplier_offer_id: `${runTag}-offer`, supplier_category_id: 'mobile_legends_philippines',
      supplier_cost_usd: 1, supplier_review_required: false,
    }).select('id').single();
    if (linked.error || !linked.data) throw new Error(`Synthetic linked package fixture failed (SQLSTATE ${linked.error?.code || 'unknown'}).`);
    const campaign = await createCampaign({ code: `SUP-${randomUUID().slice(0, 8).toUpperCase()}` });
    expect((await campaignStatus(campaign.id, 'ACTIVE')).response.status).toBe(200);
    const denied = await validateCode(campaign.payload.code as string, linked.data.id, { ip: '198.51.100.78' });
    expect(denied.response.status).toBe(400);
    expect(String(denied.body.error)).toMatch(/supplier/i);
    const settings = await db.from('app_settings').select('supplier_fulfillment_release_enabled').eq('id', 1).single();
    expect(settings.data?.supplier_fulfillment_release_enabled).toBe(false);
  });

  it('applies a durable per-edge-IP validation budget and rejects malformed request bodies', async () => {
    const ip = `198.51.100.${80 + Math.floor(Math.random() * 10)}`;
    const results = await Promise.all(Array.from({ length: 11 }, (_, index) => appRequest('/api/vouchers/validate', 'POST', {
      code: `BAD-${index}`, packageId,
    }, { cookie: null, ip })));
    expect(results.filter(({ response }) => response.status === 429)).toHaveLength(1);
    const malformed = await fetch(new URL('/api/vouchers/validate', localOrigin()), {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.95' }, body: '{not-json',
    });
    expect(malformed.status).toBe(400);
  });

  it('bounds voucher-code probes made directly against both public order RPCs', async () => {
    await clearDisposableVoucherRateBuckets();
    const anonymous = anonDb();
    const oneEmail = `bounded-${runTag}@example.invalid`;
    const emailAttempts = await Promise.all(Array.from({ length: 11 }, (_, index) => anonymous.rpc('create_order', {
      p_game_id: gameId,
      p_package_id: packageId,
      p_email: oneEmail,
      p_customer_name: 'Synthetic rate-limit probe',
      p_player_inputs: { player_id: 'synthetic-rate-limit-player' },
      p_payment_method: 'manual',
      p_voucher_code: `INVALID-${index}-${runTag}`,
      p_voucher_email: oneEmail,
    })));
    const emailRows = emailAttempts.map((attempt) => responseData(Array.isArray(attempt.data) ? attempt.data[0] : attempt.data));
    expect(emailAttempts.every((attempt) => attempt.error === null)).toBe(true);
    expect(emailRows.filter((row) => row?.out_error === 'Promotion validation is temporarily unavailable.')).toHaveLength(1);

    await clearDisposableVoucherRateBuckets();
    const rotatingEmailAttempts = await Promise.all(Array.from({ length: 61 }, (_, index) => {
      const email = `rotating-${index}-${runTag}@example.invalid`;
      return anonymous.rpc('create_order_idempotent', {
        p_game_id: gameId,
        p_package_id: packageId,
        p_email: email,
        p_customer_name: 'Synthetic aggregate rate-limit probe',
        p_player_inputs: { player_id: 'synthetic-rate-limit-player', __rfz_order_access_hash: 'a'.repeat(64) },
        p_payment_method: 'manual',
        p_voucher_code: `INVALID-ROTATED-${index}-${runTag}`,
        p_voucher_email: email,
        p_request_key: randomUUID(),
      });
    }));
    const rotatingRows = rotatingEmailAttempts.map((attempt) => responseData(Array.isArray(attempt.data) ? attempt.data[0] : attempt.data));
    expect(rotatingEmailAttempts.every((attempt) => attempt.error === null)).toBe(true);
    expect(rotatingRows.filter((row) => row?.out_error === 'Promotion validation is temporarily unavailable.')).toHaveLength(1);
    expect(rotatingRows.filter((row) => row?.out_error === 'Invalid or unavailable promotion code.')).toHaveLength(60);
  }, 90_000);
});
