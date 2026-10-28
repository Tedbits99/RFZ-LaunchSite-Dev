import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type MailSummary = { id: string; date?: string };
type Observation = {
  localResponses: Array<{ method: string; path: string; status: number }>;
  pageErrors: Array<{ path: string }>;
  consoleErrorCount: number;
  serverErrors: Array<{ path: string; status: number }>;
  blockedProviderHosts: string[];
  blockedStaticHosts: string[];
  sanitizedBrowserTrace: Array<{
    timestamp: string;
    event: string;
    service: 'app' | 'auth' | 'mail-catcher';
    path: string;
    method?: string;
    status?: number;
  }>;
};

const baseURL = 'http://127.0.0.1:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitURL = process.env.E2E_MAILPIT_URL;
const schemaMode = process.env.E2E_WALLET_SCHEMA_MODE;
const localApiPort = schemaMode === 'installed-locked' ? '55321' : '54321';
const localDbPort = schemaMode === 'installed-locked' ? '55322' : '54322';
const localMailpitPort = schemaMode === 'installed-locked' ? '55324' : '54324';
const candidateSha = process.env.E2E_CANDIDATE_SHA;
const oldPassword = 'Disposable-Old-42!abc';
const newPassword = 'Disposable-New-84!xyz';
const rejectedReusePassword = 'Disposable-Reuse-91!abc';

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`PR82 isolated acceptance failed: ${label}`);
}

function requireLocalConfiguration() {
  assert(supabaseUrl && anonKey && serviceKey && mailpitURL, 'local Auth services are configured');
  assert(schemaMode === 'absent' || schemaMode === 'installed-locked', 'wallet schema test mode is explicit');
  assert(process.env.E2E_LOCAL_API_PORT === localApiPort && process.env.E2E_LOCAL_DB_PORT === localDbPort && process.env.E2E_LOCAL_MAILPIT_PORT === localMailpitPort, 'isolated local service ports match the selected schema mode');
  assert(candidateSha && /^[0-9a-f]{40}$/.test(candidateSha), 'candidate SHA is exact');
  const url = new URL(supabaseUrl);
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === localApiPort, 'Supabase URL is loopback only');
  assert(url.hostname === '127.0.0.1', 'browser Supabase origin uses the exact permitted loopback host');
  const mailpit = new URL(mailpitURL);
  assert(mailpit.protocol === 'http:' && mailpit.hostname === '127.0.0.1' && mailpit.port === localMailpitPort, 'Mailpit uses the exact permitted loopback origin');
  for (const key of [
    'PAYMONGO_SECRET_KEY', 'PAYMENT_PAYMONGO_SECRET_KEY', 'FAZERCARDS_API_KEY',
    'SUPPLIER_FAZERCARDS_API_KEY', 'SMTP_PASSWORD', 'CRYPTO_PROVIDER_SECRET',
  ]) assert(!process.env[key], 'external provider credentials are absent');
}

function safePath(page: Page) {
  return new URL(page.url()).pathname;
}

async function gotoPath(page: Page, pathname: string, label: string) {
  try {
    await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  } catch {
    throw new Error(`PR82 isolated navigation failed: ${label}`);
  }
}

async function gotoMailLink(page: Page, link: string, label: string) {
  const url = new URL(link);
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === localApiPort, `${label} link targets local GoTrue`);
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    throw new Error(`PR82 isolated email callback failed: ${label}`);
  }
}

async function assertRunFazoneLogo(page: Page) {
  const logo = page.locator('img[alt="RunFazone"]:visible').first();
  await expect(logo).toBeVisible();
  await expect.poll(
    () => logo.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0),
    { timeout: 15_000 },
  ).toBe(true);
}

async function guardedContext(browser: Browser, testInfo: TestInfo, observations: Observation): Promise<BrowserContext> {
  const mobile = testInfo.project.name.startsWith('mobile');
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const allowed = requestUrl.protocol === 'http:'
      && requestUrl.hostname === '127.0.0.1'
      && ([3000, Number(localApiPort), Number(localMailpitPort)].includes(Number(requestUrl.port)));
    if (allowed) {
      await route.continue();
      return;
    }
    const host = requestUrl.hostname.toLowerCase();
    if (/supabase\.co$|paymongo|fazercards|moogold|smtp|sendgrid|mailgun|coinbase|crypto|supplier/.test(host)) {
      observations.blockedProviderHosts.push(host);
    } else {
      observations.blockedStaticHosts.push(host);
    }
    await route.abort('blockedbyclient');
  });
  return context;
}

function localService(urlValue: string): { service: 'app' | 'auth' | 'mail-catcher'; path: string } | null {
  let url: URL;
  try { url = new URL(urlValue); } catch { return null; }
  if (url.origin === baseURL) return { service: 'app', path: url.pathname };
  if (supabaseUrl && url.origin === new URL(supabaseUrl).origin) return { service: 'auth', path: url.pathname };
  if (mailpitURL && url.origin === new URL(mailpitURL).origin) return { service: 'mail-catcher', path: url.pathname };
  return null;
}

function recordTrace(observations: Observation, event: string, urlValue: string, details: { method?: string; status?: number } = {}) {
  const local = localService(urlValue);
  if (!local) return;
  observations.sanitizedBrowserTrace.push({
    timestamp: new Date().toISOString(),
    event,
    service: local.service,
    path: local.path,
    ...details,
  });
}

function writeRegistrationDiagnostic(testInfo: TestInfo, status: number | null, category: string) {
  const directory = process.env.E2E_EVIDENCE_DIR;
  assert(directory, 'registration diagnostic directory is configured');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${schemaMode}-${testInfo.project.name}-registration-diagnostic.json`), JSON.stringify({
    candidate_sha: candidateSha,
    schema_mode: schemaMode,
    viewport: testInfo.project.name,
    test_identity: 'synthetic local-only identities',
    step: 'customer_registration',
    route: '/api/auth/register',
    method: 'POST',
    http_status: status,
    category,
    timestamp_utc: new Date().toISOString(),
    request_body_included: false,
    response_body_included: false,
  }, null, 2));
}

function observePage(page: Page, observations: Observation) {
  page.on('response', (response) => {
    const local = localService(response.url());
    if (!local) return;
    const method = response.request().method();
    const status = response.status();
    recordTrace(observations, 'response', response.url(), { method, status });
    if (local.service !== 'app') return;
    observations.localResponses.push({ method, path: local.path, status });
    if (status >= 500) observations.serverErrors.push({ path: local.path, status });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) recordTrace(observations, 'navigation', frame.url());
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    observations.consoleErrorCount += 1;
    recordTrace(observations, 'console_error', message.location().url || page.url());
  });
  page.on('pageerror', () => {
    observations.pageErrors.push({ path: safePath(page) });
    recordTrace(observations, 'page_error', page.url());
  });
  page.on('requestfailed', (request) => recordTrace(observations, 'request_failed', request.url(), { method: request.method() }));
}

async function observedPage(context: BrowserContext, observations: Observation) {
  const page = await context.newPage();
  observePage(page, observations);
  return page;
}

async function evidence(page: Page, testInfo: TestInfo, observations: Observation, name: string) {
  const directory = process.env.E2E_EVIDENCE_DIR;
  assert(directory, 'sanitized evidence directory is configured');
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${schemaMode}-${testInfo.project.name}-${name}`;
  const screenshot = path.join(directory, `${filename}.png`);
  try {
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('input[type="email"]'), page.locator('input[type="password"]')],
    });
  } catch {
    throw new Error(`PR82 evidence capture failed: ${name}`);
  }
  fs.writeFileSync(path.join(directory, `${filename}.json`), JSON.stringify({
    candidate_sha: candidateSha,
    schema_mode: schemaMode,
    viewport: testInfo.project.name,
    test_identity: 'synthetic local-only identities',
    case: name,
    screenshot: path.basename(screenshot),
    sanitized_http_observations: observations.localResponses.filter((item) => item.path.startsWith('/api/') || item.path.startsWith('/auth/')).slice(-80),
    sanitized_browser_trace: observations.sanitizedBrowserTrace.slice(-300),
    browser_console_error_count: observations.consoleErrorCount,
    browser_page_error_count: observations.pageErrors.length,
    server_error_count: observations.serverErrors.length,
    external_provider_attempts_blocked: observations.blockedProviderHosts.length,
    raw_auth_traces_or_storage_state_included: false,
  }, null, 2));
}

function parseEmailBody(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) parseEmailBody(item, found);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:text|html|body|content)$/i.test(key)) parseEmailBody(child, found);
    }
  }
  return found;
}

async function mailboxMessages(email: string): Promise<MailSummary[]> {
  let response: Response;
  const query = new URLSearchParams({ query: `to:${email}`, limit: '100' });
  try { response = await fetch(`${mailpitURL}/api/v1/search?${query.toString()}`); }
  catch { throw new Error('PR82 local email catcher is unreachable.'); }
  if (!response.ok) throw new Error(`PR82 local Mailpit search returned HTTP ${response.status}.`);
  const body = await response.json().catch(() => null) as unknown;
  const list = body && typeof body === 'object' && Array.isArray((body as { messages?: unknown }).messages)
    ? (body as { messages: unknown[] }).messages
    : null;
  assert(list, 'local Mailpit search response has a recognized structure');
  return list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: String(item.ID ?? item.id ?? ''),
      date: typeof item.Created === 'string' ? item.Created : typeof item.date === 'string' ? item.date : undefined,
    }))
    .filter((item) => item.id.length > 0);
}

async function waitForLocalAuthEmailCooldown(messages: MailSummary[]) {
  const latestSentAt = Math.max(...messages.map((message) => Date.parse(message.date || '')));
  assert(Number.isFinite(latestSentAt), 'Mailpit exposes the previous local email delivery timestamp');
  // The disposable GoTrue config enforces a 1s per-user SMTP cooldown. Wait
  // against the actual delivered message time, with margin for Mailpit's
  // timestamp precision and runner scheduling, instead of racing the provider.
  const resendAllowedAt = latestSentAt + 2_000;
  await expect.poll(() => Date.now(), { timeout: 10_000, intervals: [50, 100, 250] })
    .toBeGreaterThanOrEqual(resendAllowedAt);
}

async function capturedLink(email: string, minMessageCount: number, kind: 'signup' | 'recovery') {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const messages = await mailboxMessages(email);
    if (messages.length >= minMessageCount) {
      const ordered = [...messages].sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || ''));
      for (const message of ordered) {
        let response: Response;
        try {
          response = await fetch(`${mailpitURL}/api/v1/message/${encodeURIComponent(message.id)}`);
        } catch {
          throw new Error('PR82 local Mailpit message lookup failed.');
        }
        if (!response.ok) continue;
        const detail = await response.json().catch(() => null) as unknown;
        const strings = parseEmailBody(detail);
        for (const content of strings) {
          const urls = content.replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) || [];
          for (const candidate of urls) {
            const cleaned = candidate.replace(/[),.;]+$/, '');
            let url: URL;
            try { url = new URL(cleaned); } catch { continue; }
            const queryType = url.searchParams.get('type');
            const contentText = `${url.pathname} ${url.searchParams.get('redirect_to') || ''}`;
            const expected = kind === 'recovery'
              ? queryType === 'recovery' || /type=recovery/.test(contentText)
              : queryType === 'signup' || queryType === 'email' || /type=(signup|email)/.test(contentText);
            if (expected && url.pathname.includes('/auth/')) return cleaned;
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`PR82 local ${kind} email was not captured by Mailpit.`);
}

function serviceClient(): SupabaseClient {
  requireLocalConfiguration();
  return createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createAdminIdentity(client: SupabaseClient, email: string, role: string, active: boolean) {
  const created = await client.auth.admin.createUser({
    email,
    password: oldPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Synthetic acceptance administrator' },
  });
  assert(!created.error && created.data.user, 'synthetic local administrator Auth identity exists');
  const row = await client.from('admins').insert({
    id: created.data.user.id,
    email,
    name: 'Synthetic Acceptance Admin',
    role,
    is_active: active,
  });
  assert(!row.error, 'synthetic administrator role fixture is created');
}

async function createOrderFixture(localAdmin: SupabaseClient, email: string, password: string) {
  const client = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert(!signedIn.error && signedIn.data.user, 'confirmed customer has a real local Auth session');
  const game = await client.from('games').select('id').eq('slug', 'mobile-legends').single();
  assert(!game.error && game.data, 'canonical synthetic game fixture is available');
  const product = await client.from('packages').select('id').eq('game_id', game.data.id).eq('is_active', true).limit(1).single();
  assert(!product.error && product.data, 'canonical synthetic product package is available');
  const manualPayment = await localAdmin.from('payment_config')
    .select('method_key,provider_type,is_enabled')
    .eq('method_key', 'gcash')
    .single();
  assert(!manualPayment.error && manualPayment.data.is_enabled && manualPayment.data.provider_type === 'manual', 'disposable database exposes its seeded manual payment method');
  // Match the real checkout route: generate an unguessable capability, send
  // only its SHA-256 digest through the customer-authenticated RPC, and let
  // the database trigger persist that digest outside player_inputs.
  const orderCapability = randomBytes(32).toString('base64url');
  const orderCapabilityHash = createHash('sha256').update(orderCapability, 'utf8').digest('hex');
  const order = await client.rpc('create_order', {
    p_game_id: game.data.id,
    p_package_id: product.data.id,
    p_email: email,
    p_customer_name: 'Synthetic Customer A',
    p_player_inputs: {
      user_id: 'synthetic-player-1001',
      server_id: '1001',
      __rfz_order_access_hash: orderCapabilityHash,
    },
    p_payment_method: manualPayment.data.method_key,
    p_voucher_code: null,
    p_voucher_email: null,
  });
  if (order.error) {
    const code = typeof order.error.code === 'string' && /^[0-9A-Z]{5}$/.test(order.error.code)
      ? order.error.code
      : 'unknown';
    const status = 'status' in order.error && typeof order.error.status === 'number'
      ? order.error.status
      : null;
    console.error('ISOLATED_ORDER_RPC_FAILURE', {
      stage: 'authenticated_create_order',
      http_status: status,
      sqlstate: code,
      category: code === '42501' ? 'insufficient_privilege' : code === 'P0001' ? 'database_exception' : 'postgrest_error',
    });
  }
  assert(!order.error, 'synthetic pending manual order is created by authenticated RPC');
  const row = Array.isArray(order.data) ? order.data[0] : order.data;
  assert(row && typeof row.out_order_id === 'string' && !row.out_error, 'synthetic order fixture has an owned order ID');
  const orderId = row.out_order_id as string;
  const persisted = await localAdmin.from('orders').select('player_inputs').eq('id', orderId).single();
  assert(!persisted.error && !('__rfz_order_access_hash' in (persisted.data.player_inputs as Record<string, unknown>)), 'order capability digest is not exposed in customer player inputs');
  const storedCapability = await localAdmin.from('guest_order_access')
    .select('order_id')
    .eq('order_id', orderId)
    .eq('token_hash', orderCapabilityHash)
    .maybeSingle();
  assert(!storedCapability.error && storedCapability.data?.order_id === orderId, 'order capability digest is stored in the protected capability table');
  return { client, userId: signedIn.data.user.id, orderId, reference: row.out_reference as string };
}

async function seedWalletFixtures(client: SupabaseClient, customerA: string, customerB: string) {
  const walletTables = await client.from('rf_coin_settings').select('enabled,topups_enabled,spending_enabled').eq('id', 1).single();
  assert(!walletTables.error && !walletTables.data.enabled && !walletTables.data.topups_enabled && !walletTables.data.spending_enabled, 'wallet feature and financial settings remain disabled');
  const walletRows = await client.from('rf_coin_wallets').upsert([
    { user_id: customerA, balance_coins: 0 },
    { user_id: customerB, balance_coins: 321 },
  ], { onConflict: 'user_id' });
  assert(!walletRows.error, 'synthetic customer wallet rows are seeded only in disposable database');
  const ledgerRow = await client.from('rf_coin_ledger').insert({
    wallet_user_id: customerB,
    direction: 'credit',
    amount_coins: 321,
    kind: 'manual_credit',
    balance_after: 321,
    reason: 'Disposable isolated acceptance fixture',
    reference_type: 'e2e_fixture',
    reference_id: 'pr82-customer-b',
    actor_type: 'system',
    idempotency_key: `pr82-e2e-${process.env.E2E_RUN_TAG}-customer-b`,
  });
  assert(!ledgerRow.error, 'synthetic immutable wallet ledger fixture is inserted');
}

async function sameOriginJson(page: Page, pathname: string, method = 'GET', body?: unknown) {
  assert(new URL(page.url()).origin === new URL(baseURL).origin, 'same-origin browser API request is made from the local application origin');
  return page.evaluate(async ({ pathname, method, body }) => {
    const response = await fetch(pathname, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  }, { pathname, method, body });
}

async function customerSessionExpiresAt(context: BrowserContext): Promise<number> {
  const cookieName = 'rfz-customer-auth';
  const chunks = (await context.cookies(baseURL))
    .filter((cookie) => cookie.name === cookieName || new RegExp(`^${cookieName}\\.\\d+$`).test(cookie.name))
    .sort((left, right) => {
      const index = (name: string) => name === cookieName ? -1 : Number(name.slice(cookieName.length + 1));
      return index(left.name) - index(right.name);
    });
  assert(chunks.length > 0, 'customer session cookie exists without exporting its value');
  const encoded = chunks.map((cookie) => cookie.value).join('');
  const payload = encoded.startsWith('base64-')
    ? Buffer.from(encoded.slice('base64-'.length), 'base64url').toString('utf8')
    : encoded;
  let session: unknown;
  try { session = JSON.parse(payload); } catch { throw new Error('PR82 customer session cookie has an unexpected local format.'); }
  const expiresAt = session && typeof session === 'object' && 'expires_at' in session
    ? Number((session as { expires_at?: unknown }).expires_at)
    : Number.NaN;
  const hasRefreshToken = Boolean(session && typeof session === 'object' && 'refresh_token' in session
    && typeof (session as { refresh_token?: unknown }).refresh_token === 'string');
  assert(Number.isFinite(expiresAt) && hasRefreshToken, 'customer session has an expiry and refresh token in memory');
  return expiresAt;
}

async function registerCustomer(page: Page, email: string, name: string, testInfo: TestInfo, observations: Observation, screenshot: string) {
  const initialCount = (await mailboxMessages(email)).length;
  await gotoPath(page, '/register', 'customer registration');
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  if (screenshot === 'customer-register') await evidence(page, testInfo, observations, screenshot);
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(oldPassword);
  const registerResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === baseURL && url.pathname === '/api/auth/register' && response.request().method() === 'POST';
  }, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Create Account' }).click();
  let response: Awaited<typeof registerResponse>;
  try {
    response = await registerResponse;
  } catch {
    writeRegistrationDiagnostic(testInfo, null, 'request_no_response');
    throw new Error('PR82 registration failed: no HTTP response was observed.');
  }
  const status = response.status();
  recordTrace(observations, 'customer_registration_response', response.url(), { method: 'POST', status });
  if (status !== 202) {
    const category = status === 400 ? 'request_rejected' : status === 503 ? 'temporarily_unavailable' : 'unexpected_status';
    writeRegistrationDiagnostic(testInfo, status, category);
    throw new Error(`PR82 registration failed: http_status=${status} category=${category}.`);
  }
  try {
    await expect(page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
  } catch {
    writeRegistrationDiagnostic(testInfo, status, 'accepted_response_ui_state_missing');
    throw new Error(`PR82 registration failed: http_status=${status} category=accepted_response_ui_state_missing.`);
  }
  const link = await capturedLink(email, initialCount + 1, 'signup');
  await gotoMailLink(page, link, 'signup confirmation');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  assert(safePath(page) === '/account', 'email confirmation activates the customer and redirects to account');
  return link;
}

async function assertLogin(page: Page, email: string, password: string) {
  await gotoPath(page, '/login', 'customer login');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  assert(safePath(page) === '/account', 'valid customer credentials open account dashboard');
}

test('real customer and admin journeys, isolation, wallet locks and all eight stores', async ({ browser, page }, testInfo) => {
  requireLocalConfiguration();
  assert(process.env.NEXT_PUBLIC_APP_URL === baseURL, 'trusted app origin is loopback-only');
  const observations: Observation = {
    localResponses: [], pageErrors: [], consoleErrorCount: 0, serverErrors: [], blockedProviderHosts: [], blockedStaticHosts: [], sanitizedBrowserTrace: [],
  };
  const contexts: BrowserContext[] = [];
  const tag = `${process.env.E2E_RUN_TAG}-${testInfo.project.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const customerAEmail = `customer-a-${tag}@example.test`;
  const customerBEmail = `customer-b-${tag}@example.test`;
  const superEmail = `super-admin-${tag}@example.test`;
  const staffEmail = `staff-admin-${tag}@example.test`;
  const revokedEmail = `revoked-admin-${tag}@example.test`;
  const unknownEmail = `unassigned-user-${tag}@example.test`;
  const localAdmin = serviceClient();

  const anonymousContext = await guardedContext(browser, testInfo, observations);
  contexts.push(anonymousContext);
  const anonymousPage = await observedPage(anonymousContext, observations);
  // Use Playwright's project-configured page for the primary customer so its
  // viewport exactly matches the desktop/mobile project definition.
  await page.context().route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const allowed = requestUrl.protocol === 'http:' && requestUrl.hostname === '127.0.0.1' && [3000, Number(localApiPort), Number(localMailpitPort)].includes(Number(requestUrl.port));
    if (allowed) return route.continue();
    const host = requestUrl.hostname.toLowerCase();
    if (/supabase\.co$|paymongo|fazercards|moogold|smtp|sendgrid|mailgun|coinbase|crypto|supplier/.test(host)) observations.blockedProviderHosts.push(host);
    else observations.blockedStaticHosts.push(host);
    return route.abort('blockedbyclient');
  });
  observePage(page, observations);

  try {
    await test.step('create isolated administrative identities', async () => {
      await createAdminIdentity(localAdmin, superEmail, 'SUPER_ADMIN', true);
      await createAdminIdentity(localAdmin, staffEmail, 'ADMIN', true);
      await createAdminIdentity(localAdmin, revokedEmail, 'ADMIN', false);
      const unknown = await localAdmin.auth.admin.createUser({ email: unknownEmail, password: oldPassword, email_confirm: true });
      assert(!unknown.error && unknown.data.user, 'synthetic non-admin Auth user is created without an admin role');
    });

    await test.step('register customer A, capture real confirmation mail, and verify account activation', async () => {
      await registerCustomer(page, customerAEmail, 'Synthetic Customer A', testInfo, observations, 'customer-register');
      await assertRunFazoneLogo(page);
      const profile = await localAdmin.from('customer_profiles').select('status').eq('email_snapshot', customerAEmail).single();
      assert(!profile.error && profile.data.status === 'active', 'confirmation callback activates only the verified profile');
      await evidence(page, testInfo, observations, 'customer-account-dashboard');
    });

    const customerBContext = await guardedContext(browser, testInfo, observations);
    contexts.push(customerBContext);
    const customerBPage = await observedPage(customerBContext, observations);
    await test.step('register customer B and verify confirmation resend sends a captured email', async () => {
      const startingCount = (await mailboxMessages(customerBEmail)).length;
      await gotoPath(customerBPage, '/register', 'customer B registration');
      await customerBPage.getByLabel('Full name').fill('Synthetic Customer B');
      await customerBPage.getByLabel('Email').fill(customerBEmail);
      await customerBPage.locator('input[autocomplete="new-password"]').fill(oldPassword);
      await customerBPage.getByRole('button', { name: 'Create Account' }).click();
      await expect(customerBPage.getByRole('heading', { name: 'Almost there' })).toBeVisible();
      await expect.poll(async () => (await mailboxMessages(customerBEmail)).length, { timeout: 30_000 }).toBeGreaterThan(startingCount);
      await gotoPath(customerBPage, `/auth/confirmation?status=pending&email=${encodeURIComponent(customerBEmail)}`, 'confirmation resend');
      await customerBPage.getByLabel('Email').fill(customerBEmail);
      const messagesBeforeResend = await mailboxMessages(customerBEmail);
      const beforeResend = messagesBeforeResend.length;
      await waitForLocalAuthEmailCooldown(messagesBeforeResend);
      await customerBPage.getByRole('button', { name: 'Resend confirmation email' }).click();
      await expect(customerBPage.getByRole('status')).toContainText('confirmation instructions will be sent');
      await expect.poll(async () => (await mailboxMessages(customerBEmail)).length, { timeout: 30_000 }).toBeGreaterThan(beforeResend);
      const resendLink = await capturedLink(customerBEmail, beforeResend + 1, 'signup');
      await gotoMailLink(customerBPage, resendLink, 'resent signup confirmation');
      await expect(customerBPage.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
      assert(safePath(customerBPage) === '/account', 'resent confirmation link activates customer B');
      const profiles = await localAdmin.from('customer_profiles').select('user_id,status').eq('email_snapshot', customerBEmail).single();
      assert(!profiles.error && profiles.data.status === 'active', 'customer B profile is active after confirmation');
    });

    const { customerAFixture, customerBFixture } = await test.step('verify actual PostgREST customer ownership and wallet behavior', async () => {
      const customerAFixture = await createOrderFixture(localAdmin, customerAEmail, oldPassword);
      const customerBFixture = await createOrderFixture(localAdmin, customerBEmail, oldPassword);
      const own = await customerAFixture.client.from('orders').select('id').eq('id', customerAFixture.orderId);
      const cross = await customerBFixture.client.from('orders').select('id').eq('id', customerAFixture.orderId);
      assert(!own.error && own.data.length === 1, 'Customer A can read its owned order through PostgREST');
      assert(!cross.error && cross.data.length === 0, 'Customer B cannot read Customer A order through PostgREST');
      const anonClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const anonymousOrders = await anonClient.from('orders').select('id').eq('id', customerAFixture.orderId);
      assert(anonymousOrders.error?.code === '42501' || (!anonymousOrders.error && anonymousOrders.data.length === 0), 'anonymous role is denied or returns no customer order through public-key PostgREST');
      if (schemaMode === 'installed-locked') {
        await seedWalletFixtures(localAdmin, customerAFixture.userId, customerBFixture.userId);
        const aWalletRows = await customerAFixture.client.from('rf_coin_wallets').select('user_id,balance_coins');
        const bWalletRows = await customerBFixture.client.from('rf_coin_wallets').select('user_id,balance_coins');
        assert(!aWalletRows.error && aWalletRows.data.length === 1 && Number(aWalletRows.data[0].balance_coins) === 0, 'Customer A RLS returns only its real synthetic zero wallet');
        assert(!bWalletRows.error && bWalletRows.data.length === 1 && Number(bWalletRows.data[0].balance_coins) === 321, 'Customer B RLS returns only its synthetic wallet');
        const aLedger = await customerAFixture.client.from('rf_coin_ledger').select('wallet_user_id');
        const bLedger = await customerBFixture.client.from('rf_coin_ledger').select('wallet_user_id');
        assert(!aLedger.error && aLedger.data.length === 0, 'Customer A cannot read Customer B ledger rows');
        assert(!bLedger.error && bLedger.data.length === 1 && bLedger.data[0].wallet_user_id === customerBFixture.userId, 'Customer B reads only its own wallet ledger');
      } else {
        const missingWallet = await customerAFixture.client.from('rf_coin_settings').select('id').limit(1);
        assert(Boolean(missingWallet.error), 'wallet schema is genuinely absent in this isolated variant');
      }
      return { customerAFixture, customerBFixture };
    });

    await test.step('verify anonymous and cross-customer browser/API denials', async () => {
      await gotoPath(anonymousPage, '/login', 'anonymous API origin');
      const anonymousResponse = await sameOriginJson(anonymousPage, '/api/account/wallet');
      assert(anonymousResponse.status === 401, 'anonymous wallet API is denied');
      await gotoPath(anonymousPage, '/account', 'anonymous account denial');
      await expect(anonymousPage).toHaveURL((url) => url.pathname === '/login', { timeout: 10_000 });
      assert(safePath(anonymousPage) === '/login', 'anonymous customer route redirects to login');
      await expect(anonymousPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(anonymousPage.getByRole('heading', { name: /Welcome back/ })).toHaveCount(0);
      await expect(anonymousPage.getByText(customerAEmail, { exact: true })).toHaveCount(0);

      const bOrderList = await sameOriginJson(customerBPage, '/api/account/profile');
      assert(bOrderList.status === 200, 'Customer B account session is accepted');
      await gotoPath(customerBPage, '/account/orders', 'Customer B order history');
      const customerBOrderLink = customerBPage.locator(`a[href="/account/orders/${customerBFixture.orderId}"]:visible`);
      await expect(customerBOrderLink).toHaveCount(1);
      await expect(customerBOrderLink).toContainText(customerBFixture.reference);
      await expect(customerBPage.getByText(customerAFixture.reference, { exact: true })).toHaveCount(0);
      const detailResponse = await customerBPage.goto(`${baseURL}/account/orders/${customerAFixture.orderId}`, { waitUntil: 'domcontentloaded' });
      const detailStatus = detailResponse?.status() ?? null;
      const otherCustomerOrderReferenceVisible = await customerBPage.getByText(customerAFixture.reference, { exact: true }).count() > 0;
      const streamedNotFound = detailStatus === 200;
      if (streamedNotFound) {
        // With the root loading boundary, Next may commit a streaming 200
        // before the Server Component calls notFound(). Require its actual
        // generic 404 UI, and still require the foreign order data to be absent.
        await expect(customerBPage.getByText('This page could not be found.', { exact: true })).toBeVisible();
      }
      await evidence(customerBPage, testInfo, observations, 'customer-cross-order-denial');
      assert(
        (detailStatus === 404 || streamedNotFound) && !otherCustomerOrderReferenceVisible,
        `Customer B cross-order denial: http_status=${detailStatus ?? 'no_response'} streamed_not_found=${streamedNotFound} protected_reference_visible=${otherCustomerOrderReferenceVisible}`,
      );
      const adminRouteResponse = await customerBPage.goto(`${baseURL}/admin`, { waitUntil: 'domcontentloaded' });
      const adminStatus = adminRouteResponse?.status() ?? null;
      const streamedAdminNotFound = adminStatus === 200;
      if (streamedAdminNotFound) {
        await expect(customerBPage.getByText('This page could not be found.', { exact: true })).toBeVisible();
      }
      const adminOverviewVisible = await customerBPage.getByText('Overview', { exact: true }).count() > 0;
      const adminDashboardVisible = await customerBPage.getByText('Dashboard', { exact: true }).count() > 0;
      await evidence(customerBPage, testInfo, observations, 'customer-admin-denial');
      assert(
        (adminStatus === 404 || streamedAdminNotFound) && !adminOverviewVisible && !adminDashboardVisible,
        `Authenticated customer admin denial: http_status=${adminStatus ?? 'no_response'} streamed_not_found=${streamedAdminNotFound} admin_content_visible=${adminOverviewVisible || adminDashboardVisible}`,
      );
      const adminApi = await sameOriginJson(customerBPage, '/api/admin/rf-coins');
      assert(adminApi.status === 401 || adminApi.status === 403, 'customer cannot read privileged RF Coins API');
    });

    await test.step('verify customer session persistence, invalid password, logout, and login', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
      const expiresBeforeRefresh = await customerSessionExpiresAt(page.context());
      const expiryBoundary = expiresBeforeRefresh * 1000 + 1_000;
      const waitTimeout = Math.max(10_000, expiryBoundary - Date.now() + 10_000);
      await expect.poll(() => Date.now(), { timeout: waitTimeout, intervals: [250] }).toBeGreaterThanOrEqual(expiryBoundary);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
      const expiresAfterRefresh = await customerSessionExpiresAt(page.context());
      assert(expiresAfterRefresh > expiresBeforeRefresh + 30, 'expired access token was refreshed into a new customer session');
      observations.sanitizedBrowserTrace.push({
        timestamp: new Date().toISOString(),
        event: 'customer_session_refresh_verified',
        service: 'app',
        path: '/account',
      });
      await gotoPath(page, '/account/profile', 'customer profile');
      await expect(page.getByRole('heading', { name: 'Profile Settings' })).toBeVisible();
      await page.getByRole('button', { name: /Account menu for/ }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      assert(safePath(page) === '/login', 'customer logout clears the customer session');
      await evidence(page, testInfo, observations, 'customer-login');
      await page.getByLabel('Email').fill(customerAEmail);
      await page.locator('input[autocomplete="current-password"]').fill('Disposable-Wrong-77!xyz');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('alert')).toContainText('Unable to sign in with those credentials');
      assert(safePath(page) === '/login', 'incorrect customer password is rejected');
      await page.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
      assert(safePath(page) === '/account', 'existing confirmed customer can sign in');
      await evidence(page, testInfo, observations, 'customer-account-session');

      await gotoPath(page, '/account/orders', 'Customer A order history');
      const customerAOrderLink = page.locator(`a[href="/account/orders/${customerAFixture.orderId}"]:visible`);
      await expect(customerAOrderLink).toHaveCount(1);
      await expect(customerAOrderLink).toContainText(customerAFixture.reference);
      await evidence(page, testInfo, observations, 'customer-order-history');
      await gotoPath(page, `/account/orders/${customerAFixture.orderId}`, 'Customer A order detail');
      await expect(page.getByText(customerAFixture.reference, { exact: true })).toBeVisible();
      await evidence(page, testInfo, observations, 'customer-order-detail');
    });

    await test.step('verify local password recovery, password update, old/new passwords, and link reuse denial', async () => {
      await page.getByRole('button', { name: /Account menu for/ }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await gotoPath(page, '/forgot-password', 'password recovery request');
      const beforeRecovery = (await mailboxMessages(customerAEmail)).length;
      await page.getByLabel('Email').fill(customerAEmail);
      await page.getByRole('button', { name: 'Send Reset Link' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      const resetLink = await capturedLink(customerAEmail, beforeRecovery + 1, 'recovery');
      await gotoMailLink(page, resetLink, 'password recovery callback');
      assert(safePath(page) === '/auth/reset-password', 'recovery email reaches trusted reset page');
      await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
      await page.locator('input[autocomplete="new-password"]').fill(newPassword);
      await page.getByRole('button', { name: 'Update password' }).click();
      await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();
      await evidence(page, testInfo, observations, 'password-reset-success');

      await page.getByRole('link', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await page.getByLabel('Email').fill(customerAEmail);
      await page.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('alert')).toContainText('Unable to sign in with those credentials');
      assert(safePath(page) === '/login', 'old password is rejected after recovery');
      await page.locator('input[autocomplete="current-password"]').fill(newPassword);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
      assert(safePath(page) === '/account', 'new password is accepted after recovery');

      await page.getByRole('button', { name: /Account menu for/ }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await gotoMailLink(page, resetLink, 'one-time recovery link reuse');
      assert(safePath(page) === '/auth/reset-password', 'reused recovery link stays at reset boundary');
      await page.locator('input[autocomplete="new-password"]').fill(rejectedReusePassword);
      await page.getByRole('button', { name: 'Update password' }).click();
      await expect(page.getByRole('alert')).toContainText('invalid or has expired');
      await assertLogin(page, customerAEmail, newPassword);
      await evidence(page, testInfo, observations, 'password-reuse-denied');
    });

    await test.step('verify safe wallet behavior for the selected schema state', async () => {
      await gotoPath(page, '/account/wallet', 'customer wallet');
      if (schemaMode === 'absent') {
        await expect(page.getByText(/wallet setup has not been deployed/i)).toBeVisible();
        const response = await sameOriginJson(page, '/api/account/wallet');
        assert(response.status === 200 && response.payload?.walletStatus === 'not_deployed' && response.payload?.wallet === null, 'missing wallet schema is honestly unavailable, not a fabricated zero');
      } else {
        await expect(page.getByText('RF Coins Balance')).toBeVisible();
        await expect(page.getByText('0 RF', { exact: true })).toBeVisible();
        await expect(page.getByText(/funding is release-locked/i)).toBeVisible();
        const response = await sameOriginJson(page, '/api/account/wallet');
        assert(response.status === 200 && response.payload?.walletStatus === 'ready' && Number(response.payload?.wallet?.balance_coins) === 0, 'initialized Customer A wallet displays the actual synthetic zero row');
        const ledger = await sameOriginJson(page, '/api/account/wallet/ledger');
        assert(ledger.status === 200 && Array.isArray(ledger.payload?.entries) && ledger.payload.entries.length === 0, 'zero-balance wallet has no fabricated ledger entries');
      }
      const topup = await sameOriginJson(page, '/api/account/wallet/topup', 'POST', { packageId: '00000000-0000-4000-8000-000000000001' });
      assert(topup.status === 503, 'wallet funding endpoint remains server-side release-locked');
      await evidence(page, testInfo, observations, 'customer-wallet-safe-state');
    });

    await test.step('verify the RF Coins payment option is unique, disabled, and non-financial on all eight stores', async () => {
      const slugs = ['mobile-legends', 'pubg-mobile', 'free-fire', 'genshin-impact', 'valorant', 'honor-of-kings', 'roblox', 'call-of-duty-mobile'];
      for (const slug of slugs) {
        await gotoPath(anonymousPage, `/games/${slug}`, `storefront ${slug}`);
        await expect(anonymousPage.getByRole('heading', { name: 'Payment Methods' })).toBeVisible();
        const walletMethod = anonymousPage.locator('input[name="payment-method"][value="rf_coin_wallet"]');
        assert(await walletMethod.count() === 1, `${slug} renders RF Coins Wallet exactly once`);
        await expect(walletMethod).toBeDisabled();
        assert(await anonymousPage.locator('input[name="payment-method"]:not(:disabled)').count() > 0, `${slug} retains an ordinary product checkout method`);
        if (slug === 'mobile-legends') await evidence(anonymousPage, testInfo, observations, 'storefront-payment-methods');
      }
      const width = await anonymousPage.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
      if (testInfo.project.name.startsWith('mobile')) assert(width.document <= width.viewport + 1, 'mobile storefront has no horizontal page overflow');
    });

    await test.step('verify active Super Admin, dashboard session isolation, reporting and role boundaries', async () => {
      const adminContext = await guardedContext(browser, testInfo, observations);
      contexts.push(adminContext);
      const adminPage = await observedPage(adminContext, observations);

      await gotoPath(adminPage, '/secure-admin-login', 'Super Admin login');
      await adminPage.getByLabel('Email').fill(superEmail);
      await adminPage.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await adminPage.getByRole('button', { name: 'Sign In' }).click();
      await expect(adminPage.getByRole('heading', { name: 'Overview' })).toBeVisible();
      assert(safePath(adminPage) === '/admin', 'active Super Admin reaches the real dashboard');
      await assertRunFazoneLogo(adminPage);
      const crossNamespace = await sameOriginJson(adminPage, '/api/account/profile');
      assert(crossNamespace.status === 401, 'administrator cookie does not authenticate customer account APIs');
      await adminPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(adminPage.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await evidence(adminPage, testInfo, observations, 'admin-dashboard');

      await gotoPath(adminPage, '/admin/rf-coins', 'RF Coins Admin Center');
      await expect(adminPage.getByText('Wallet funding is awaiting financial release approval.')).toBeVisible();
      if (schemaMode === 'installed-locked') {
        await expect(adminPage.getByRole('tablist', { name: 'RF Coins admin sections' })).toBeVisible();
        await expect(adminPage.getByText('Funding: release locked')).toBeVisible();
        await expect(adminPage.getByText('Spending: release locked')).toBeVisible();
        for (const tab of ['Overview', 'Customer Wallets', 'Coin Top-Ups', 'Wallet Transactions', 'Manual Adjustments', 'Coin Packages', 'Wallet Settings', 'Audit Logs', 'Exceptions & Alerts']) {
          const locator = adminPage.getByRole('tab', { name: tab });
          await locator.click();
          await expect(locator).toHaveAttribute('aria-selected', 'true');
        }
        await adminPage.getByRole('tab', { name: 'Customer Wallets' }).click();
        await expect(adminPage.getByRole('link', { name: 'Export CSV' })).toBeVisible();
        let exportStatus = 0;
        const exportResponse = adminPage.waitForResponse((response) => {
          const responseUrl = new URL(response.url());
          return responseUrl.origin === baseURL && responseUrl.pathname === '/api/admin/rf-coins' && responseUrl.searchParams.has('export');
        });
        await adminPage.getByRole('link', { name: 'Export CSV' }).click();
        exportStatus = (await exportResponse).status();
        assert(exportStatus === 200, 'authorized Super Admin export is audited and succeeds in disposable database');
        await evidence(adminPage, testInfo, observations, 'admin-rf-coins-center');
      } else {
        await expect(adminPage.getByRole('status')).toContainText('not been applied');
        await evidence(adminPage, testInfo, observations, 'admin-wallet-schema-unavailable');
      }

      const adminRows = await localAdmin.from('admins').select('id').eq('email', superEmail);
      assert(!adminRows.error && adminRows.data.length === 1, 'Super Admin identity remains mapped to exactly one local role row');
      await adminPage.getByRole('button', { name: 'Log out of admin dashboard' }).click();
      await expect(adminPage.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
      assert(safePath(adminPage) === '/secure-admin-login', 'administrator logout returns to its login boundary');
      const protectedAfterLogout = await adminPage.goto(`${baseURL}/admin`, { waitUntil: 'domcontentloaded' });
      assert(protectedAfterLogout?.status() === 404, 'administrator dashboard is denied after logout');
      await evidence(adminPage, testInfo, observations, 'admin-logout-denial');

      await gotoPath(adminPage, '/secure-admin-login', 'ordinary staff authentication');
      await adminPage.getByLabel('Email').fill(staffEmail);
      await adminPage.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await adminPage.getByRole('button', { name: 'Sign In' }).click();
      await expect(adminPage.getByRole('heading', { name: 'Overview' })).toBeVisible();
      const staffApi = await sameOriginJson(adminPage, '/api/admin/rf-coins');
      assert(staffApi.status === 403, 'ordinary active staff cannot use Super Admin RF Coins API');
      const staffCenter = await adminPage.goto(`${baseURL}/admin/rf-coins`, { waitUntil: 'domcontentloaded' });
      assert(staffCenter?.status() === 404, 'ordinary active staff cannot open Super Admin RF Coins Center');
      await adminPage.getByRole('button', { name: 'Log out of admin dashboard' }).click();
      await expect(adminPage.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();

      await gotoPath(adminPage, '/secure-admin-login', 'revoked administrator denial');
      await adminPage.getByLabel('Email').fill(revokedEmail);
      await adminPage.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await adminPage.getByRole('button', { name: 'Sign In' }).click();
      await expect(adminPage.getByText('Invalid email or password.')).toBeVisible();
      assert(safePath(adminPage) === '/secure-admin-login', 'inactive admin mapping is denied after valid Auth credentials');

      await adminPage.getByLabel('Email').fill(unknownEmail);
      await adminPage.locator('input[autocomplete="current-password"]').fill(oldPassword);
      await adminPage.getByRole('button', { name: 'Sign In' }).click();
      await expect(adminPage.getByText('Invalid email or password.')).toBeVisible();
      assert(safePath(adminPage) === '/secure-admin-login', 'valid Auth user without admin mapping is denied');
    });

    await test.step('verify local browser made no provider requests and produced only sanitized evidence', async () => {
      assert(observations.blockedProviderHosts.length === 0, 'no payment, supplier, external email, crypto, or hosted Supabase browser request was attempted');
      assert(observations.serverErrors.length === 0, 'no local application HTTP 5xx was observed');
      assert(observations.pageErrors.length === 0, 'no uncaught browser JavaScript exception was observed');
      const directory = process.env.E2E_EVIDENCE_DIR;
      assert(directory, 'evidence directory configured');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `${schemaMode}-${testInfo.project.name}-sanitized-http-summary.json`), JSON.stringify({
        candidate_sha: candidateSha,
        schema_mode: schemaMode,
        viewport: testInfo.project.name,
        local_http_responses: observations.localResponses,
        server_error_count: observations.serverErrors.length,
        blocked_provider_hosts: observations.blockedProviderHosts,
        blocked_static_host_count: observations.blockedStaticHosts.length,
        sanitized_browser_trace: observations.sanitizedBrowserTrace,
        browser_console_error_count: observations.consoleErrorCount,
        browser_page_error_count: observations.pageErrors.length,
        raw_auth_traces_or_storage_state_included: false,
      }, null, 2));
    });
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
  }
});
