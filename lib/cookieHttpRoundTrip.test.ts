import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createHash, createHmac, randomBytes } from 'node:crypto';

// Real Next.js route-module HTTP round trip: userland route handlers run
// inside AppRouteRouteModule.handle() exactly as the production server runs
// them. `next/headers` cookies() returns the framework's own
// MutableRequestCookiesAdapter and the route module merges those mutations
// into the returned response's Set-Cookie headers (appendMutableCookies).
// Only the Auth network (fetch) is mocked. There is NO in-memory cookie jar:
// the only cookie transport between the two handlers is the browser-facing
// Set-Cookie headers, absorbed the way a browser stores them.

const TEST_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
const SESSION_ID = '7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a';

function accessToken(sessionId = SESSION_ID, issuedAt = 1) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId, iat: issuedAt }), 'utf8').toString('base64url');
  return `${header}.${payload}.synthetic-signature`;
}

const ACCESS_TOKEN = accessToken();
const USER_ID = 'customer-roundtrip-1';

const fetchMock = vi.spyOn(globalThis, 'fetch');
let NextRequestConstructor: typeof import('next/server').NextRequest;

function getSetCookieHeaders(response: Response): string[] {
  const gsc = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  return gsc ? gsc.call(response.headers) : [response.headers.get('set-cookie') ?? ''].filter(Boolean);
}

function fingerprintOf(token: string): string {
  const sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).session_id as string;
  return createHash('sha256').update(sessionId.toLowerCase(), 'utf8').digest('hex');
}

// A minimal browser cookie store: absorbs Set-Cookie headers (path scoping
// and expiry honored) and produces Cookie request headers for the next
// request. This is the browser's role in the round trip — it never exposes
// values directly to the handlers except through real request headers.
class BrowserCookieStore {
  private store = new Map<string, { name: string; value: string; path: string; expires?: number }>();

  absorb(response: Response) {
    for (const header of getSetCookieHeaders(response)) {
      const [pair, ...attrs] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const pathAttr = attrs.find((a) => a.trim().toLowerCase().startsWith('path='));
      const path = pathAttr ? pathAttr.split('=').slice(1).join('=').trim() : '/';
      const expiresAttr = attrs.find((a) => a.trim().toLowerCase().startsWith('expires='));
      const maxAgeAttr = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
      const expiresFromHeader = expiresAttr ? Date.parse(expiresAttr.split('=').slice(1).join('=').trim()) : undefined;
      const expiresFromMaxAge = maxAgeAttr ? Date.now() + Number(maxAgeAttr.split('=')[1].trim()) * 1000 : undefined;
      const expires = expiresFromMaxAge ?? expiresFromMaxAge ?? expiresFromHeader;
      const isExpired = (expires !== undefined && expires <= Date.now()) || value === '';
      const key = `${path}\u0000${name}`;
      if (isExpired) this.store.delete(key);
      else this.store.set(key, { name, value, path, expires });
    }
  }

  headerFor(requestPath: string): string {
    return Array.from(this.store.values())
      .filter((c) => requestPath.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  has(name: string, path = '/'): boolean {
    return this.store.has(`${path}\u0000${name}`);
  }

  get(name: string, path = '/'): string | undefined {
    return this.store.get(`${path}\u0000${name}`)?.value;
  }

  names(): string[] {
    return Array.from(this.store.values()).map((c) => c.name);
  }
}

function sessionBody(token: string, userId: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `refresh-${token}`,
    user: {
      id: userId,
      email: 'user@example.test',
      email_confirmed_at: '2026-10-18T00:00:00Z',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-10-01T00:00:00Z',
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recoveryNetwork() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.includes('/auth/v1/token')) return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
    if (u.includes('/auth/v1/user') && method === 'GET') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
    if (u.includes('/auth/v1/user') && method === 'PUT') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
    if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
}

function customerConfirmationNetwork() {
  const user = {
    id: USER_ID,
    email: 'customer@example.test',
    email_confirmed_at: '2026-10-18T00:00:00Z',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Synthetic Player' },
    created_at: '2026-10-01T00:00:00Z',
  };
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/auth/v1/signup') && method === 'POST') return jsonResponse(user);
    if (url.includes('/auth/v1/verify') && method === 'POST') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
    if (url.includes('/auth/v1/token')) return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
    if (url.includes('/auth/v1/user') && method === 'GET') return jsonResponse(user);
    if (url.includes('/rest/v1/rpc/activate_customer_profile')) return jsonResponse([{ out_status: 'active', out_error: null }]);
    if (url.includes('/rest/v1/customer_profiles') && method === 'GET') {
      return jsonResponse([{ user_id: USER_ID, display_name: 'Synthetic Player', email_snapshot: user.email, status: 'active' }]);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}

async function loadRouteModule(routePath: string) {
  const userland = await import(routePath);
  const { AppRouteRouteModule } = await import('next/dist/server/route-modules/app-route/module.js');
  const dir = routePath.replace(/\/route\.ts$/, '').replace(/^@/, '');
  return new AppRouteRouteModule({
    userland: () => userland,
    getUserland: () => userland,
    definition: { kind: 'route', pathname: dir, filename: 'route.ts', bundlePath: `${dir}/route`, page: dir },
    resolvedPagePath: routePath,
    nextConfigOutput: undefined,
  } as never);
}

const PREVIEW = { previewModeId: 'preview-id', previewModeSigningKey: 'k'.repeat(32), previewModeEncryptionKey: 'e'.repeat(32) };

async function runRoute(loaded: Awaited<ReturnType<typeof loadRouteModule>>, path: string, request: NextRequest): Promise<Response> {
  return loaded.handle(request, {
    params: {},
    prerenderManifest: { version: 3, routes: {}, dynamicRoutes: {}, preview: PREVIEW },
    renderOpts: {
      supportsDynamicHTML: true,
      originalPathname: path,
      experimental: { useCacheTimeout: undefined, durableUseCacheEntries: false },
      cacheComponents: false,
      validationLevel: 'error',
    },
    sharedContext: { buildId: 'test-build', deploymentId: null },
    previewProps: PREVIEW,
  } as never);
}

function recoveryVerifierCookie(): string {
  // The SDK stores JSON.stringify("<verifier>/recovery"); the browser returns
  // it URL-encoded in the Cookie header.
  return encodeURIComponent(JSON.stringify(`${randomBytes(32).toString('hex')}/recovery`));
}

describe('Phase 1B-3 HTTP round trip: real route modules, browser-facing Set-Cookie only', () => {
  let browser: BrowserCookieStore;
  let callback: Awaited<ReturnType<typeof loadRouteModule>>;
  let complete: Awaited<ReturnType<typeof loadRouteModule>>;
  let register: Awaited<ReturnType<typeof loadRouteModule>>;
  let profile: Awaited<ReturnType<typeof loadRouteModule>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Next's async storage resolves through globalThis.AsyncLocalStorage.
    const { AsyncLocalStorage } = await import('node:async_hooks');
    (globalThis as unknown as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
    NextRequestConstructor = (await import('next/server')).NextRequest;
    browser = new BrowserCookieStore();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    callback = await loadRouteModule('@/app/auth/callback/route.ts');
    complete = await loadRouteModule('@/app/auth/reset-password/complete/route.ts');
    register = await loadRouteModule('@/app/api/auth/register/route.ts');
    profile = await loadRouteModule('@/app/api/account/profile/route.ts');
  });

  it('registration verifier and confirmation session persist in the customer namespace through account profile refresh', async () => {
    fetchMock.mockImplementation(customerConfirmationNetwork());

    const registration = await runRoute(register, '/api/auth/register', new NextRequestConstructor('https://example.test/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic Player', email: 'customer@example.test', password: 'synthetic-password-123' }),
    }));
    expect(registration.status).toBe(202);
    browser.absorb(registration);
    expect(browser.names().some((name) => name.startsWith('rfz-customer-auth') && name.includes('code-verifier'))).toBe(true);
    expect(browser.names().some((name) => name.startsWith('rfz-admin-auth') || name.startsWith('rfz-recovery-auth'))).toBe(false);

    const confirmation = await runRoute(callback, '/auth/callback', new NextRequestConstructor('https://example.test/auth/callback?code=synthetic-confirmation-code&type=signup', {
      headers: { cookie: browser.headerFor('/auth/callback') },
    }));
    expect(confirmation.headers.get('location')).toBe('https://example.test/account');
    const confirmationCookies = getSetCookieHeaders(confirmation);
    expect(confirmationCookies.some((cookie) => /^rfz-customer-auth(?:\.|=)/.test(cookie))).toBe(true);
    expect(confirmationCookies.some((cookie) => cookie.startsWith('rfz-admin-auth=') || cookie.startsWith('rfz-recovery-auth='))).toBe(false);
    expect(confirmation.headers.get('location')).not.toContain('synthetic-confirmation-code');
    browser.absorb(confirmation);

    const accountProfile = await runRoute(profile, '/api/account/profile', new NextRequestConstructor('https://example.test/api/account/profile', {
      headers: { cookie: browser.headerFor('/api/account/profile') },
    }));
    expect(accountProfile.status).toBe(200);
    expect(await accountProfile.json()).toMatchObject({ display_name: 'Synthetic Player', status: 'active' });
    expect(browser.names().some((name) => name.startsWith('rfz-customer-auth'))).toBe(true);
  });

  it('token_hash confirmation establishes a customer session without a PKCE verifier', async () => {
    fetchMock.mockImplementation(customerConfirmationNetwork());
    const confirmation = await runRoute(callback, '/auth/callback', new NextRequestConstructor('https://example.test/auth/callback?token_hash=synthetic-token-hash&type=email'));
    expect(confirmation.headers.get('location')).toBe('https://example.test/account');
    expect(getSetCookieHeaders(confirmation).some((cookie) => /^rfz-customer-auth(?:\.|=)/.test(cookie))).toBe(true);
    expect(getSetCookieHeaders(confirmation).some((cookie) => /^rfz-(?:admin|recovery)-auth(?:\.|=)/.test(cookie))).toBe(false);
    expect(confirmation.headers.get('location')).not.toContain('synthetic-token-hash');
  });

  it('recovery callback issues session + proof Set-Cookie headers; completion clears both through real HTTP responses', async () => {
    fetchMock.mockImplementation(recoveryNetwork());

    // Step 1: recovery email link lands on the callback. The request carries
    // unrelated existing sessions plus the PKCE verifier a real browser would
    // hold after resetPasswordForEmail.
    const callbackRes = await runRoute(callback, '/auth/callback', new NextRequestConstructor('https://example.test/auth/callback?code=rc&type=recovery', {
      headers: {
        cookie: [
          'sb-project-ref-auth-token=existing-default-session',
          'rfz-customer-auth=existing-customer-session',
          'rfz-admin-auth=existing-admin-session',
          `rfz-recovery-auth-code-verifier=${recoveryVerifierCookie()}`,
        ].join('; '),
      },
    }));

    const callbackCookies = getSetCookieHeaders(callbackRes);

    // Recovery-namespace session cookies were emitted as REAL Set-Cookie
    // response headers by the real Supabase SDK through cookies().
    const sessionIssued = callbackCookies.filter((c) => c.startsWith('rfz-recovery-auth='));
    expect(sessionIssued.length, `expected recovery session Set-Cookie headers, got: ${JSON.stringify(callbackCookies)}`).toBeGreaterThan(0);

    // The signed proof cookie was issued with the contract attributes.
    const proofIssued = callbackCookies.find((c) => c.startsWith('rfz-recovery-proof='));
    expect(proofIssued).toBeDefined();
    expect(proofIssued).toContain('Secure');
    expect(proofIssued).toContain('HttpOnly');
    expect(proofIssued).toContain('Path=/auth/reset-password');
    expect(proofIssued).toMatch(/Max-Age=600|Expires=/);
    expect(proofIssued).not.toContain(ACCESS_TOKEN);

    // The single-use verifier is consumed (deletion header emitted).
    expect(callbackCookies.some((c) => c.startsWith('rfz-recovery-auth-code-verifier=') && (c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')))).toBe(true);

    // No default/customer/admin namespace cookies were issued or modified.
    expect(callbackCookies.some((c) => c.startsWith('sb-project-ref-auth-token='))).toBe(false);
    expect(callbackCookies.some((c) => c.startsWith('rfz-customer-auth='))).toBe(false);
    expect(callbackCookies.some((c) => c.startsWith('rfz-admin-auth='))).toBe(false);

    // Step 2: the browser absorbs the callback response and later POSTs the
    // completion request carrying exactly what it stored.
    browser.absorb(callbackRes);
    browser.absorb(new Response(null, { headers: { 'set-cookie': 'sb-project-ref-auth-token=existing-default-session; Path=/' } }));
    browser.absorb(new Response(null, { headers: { 'set-cookie': 'rfz-customer-auth=existing-customer-session; Path=/' } }));
    browser.absorb(new Response(null, { headers: { 'set-cookie': 'rfz-admin-auth=existing-admin-session; Path=/' } }));
    expect(browser.has('rfz-recovery-proof', '/auth/reset-password')).toBe(true);
    expect(browser.names().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(true);

    const completeRes = await runRoute(complete, '/auth/reset-password/complete', new NextRequestConstructor('https://example.test/auth/reset-password/complete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        cookie: browser.headerFor('/auth/reset-password/complete'),
      },
      body: JSON.stringify({ password: 'new-password-1' }),
    }));

    expect(completeRes.status).toBe(200);
    const completeCookies = getSetCookieHeaders(completeRes);

    // The proof cookie is cleared as a real Set-Cookie header with genuine
    // expiry attributes (Max-Age=0 AND an explicit past Expires date), not
    // just an empty value.
    const proofCleared = completeCookies.find((c) => c.startsWith('rfz-recovery-proof='));
    expect(proofCleared).toBeDefined();
    expect(proofCleared!.startsWith('rfz-recovery-proof=;')).toBe(true);
    expect(proofCleared!).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(proofCleared!).toContain('Path=/auth/reset-password');

    // The recovery session cookies are removed as real Set-Cookie headers by
    // the real SDK signOut through cookies().
    const sessionCleared = completeCookies.filter((c) => c.startsWith('rfz-recovery-auth') && (c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')));
    expect(sessionCleared.length, `expected recovery session clearing headers, got: ${JSON.stringify(completeCookies)}`).toBeGreaterThan(0);

    // Customer/admin/default cookies remain untouched in both responses.
    expect(completeCookies.some((c) => c.startsWith('sb-project-ref-auth-token='))).toBe(false);
    expect(completeCookies.some((c) => c.startsWith('rfz-customer-auth='))).toBe(false);
    expect(completeCookies.some((c) => c.startsWith('rfz-admin-auth='))).toBe(false);

    // After absorbing the completion response the browser no longer holds a
    // recovery session or proof, and the unrelated sessions survive.
    browser.absorb(completeRes);
    expect(browser.has('rfz-recovery-proof', '/auth/reset-password')).toBe(false);
    expect(browser.names().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(false);
    expect(browser.get('rfz-customer-auth', '/')).toBe('existing-customer-session');
    expect(browser.get('rfz-admin-auth', '/')).toBe('existing-admin-session');
    expect(browser.get('sb-project-ref-auth-token', '/')).toBe('existing-default-session');

    // The real SDK fired the logout network call.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/v1/logout'))).toBe(true);
  });

  it('a failed exchange emits no recovery session or proof Set-Cookie headers', async () => {
    // No PKCE verifier: the real SDK fails before any session is issued.
    fetchMock.mockImplementation(async () => { throw new Error('exchange must not reach the network without a verifier'); });

    const callbackRes = await runRoute(callback, '/auth/callback', new NextRequestConstructor('https://example.test/auth/callback?code=bad&type=recovery'));
    const callbackCookies = getSetCookieHeaders(callbackRes);
    expect(callbackCookies.filter((c) => c.startsWith('rfz-recovery-auth='))).toHaveLength(0);
    expect(callbackCookies.some((c) => c.startsWith('rfz-recovery-proof='))).toBe(false);
    expect(callbackRes.headers.get('location')).toBe('https://example.test/auth/reset-password');
  });

  it('reset fails closed with a wrong-user proof: no updateUser, no clearing headers', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (u.includes('/auth/v1/token')) return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
      if (u.includes('/auth/v1/user') && method === 'GET') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
      if (u.includes('/auth/v1/user') && method === 'PUT') throw new Error('updateUser must never be reached');
      if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${u}`);
    });

    // A valid recovery session exists (callback round trip with a verifier).
    const callbackRes = await runRoute(callback, '/auth/callback', new NextRequestConstructor('https://example.test/auth/callback?code=rc&type=recovery', {
      headers: { cookie: `rfz-recovery-auth-code-verifier=${recoveryVerifierCookie()}` },
    }));
    browser.absorb(callbackRes);
    expect(browser.names().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(true);

    // But the browser holds a proof signed for a DIFFERENT user.
    const wrongUserProof = (() => {
      const claims = {
        token: 'b'.repeat(48),
        userId: 'someone-else',
        sessionFingerprint: fingerprintOf(ACCESS_TOKEN),
        purpose: 'password-reset',
        exp: Math.floor(Date.now() / 1000) + 300,
      };
      const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
      const sig = createHmac('sha256', TEST_SECRET).update(payload, 'utf8').digest('base64url');
      return `${payload}.${sig}`;
    })();
    browser.absorb(new Response(null, { headers: { 'set-cookie': `rfz-recovery-proof=${wrongUserProof}; Path=/auth/reset-password; HttpOnly` } }));

    const completeRes = await runRoute(complete, '/auth/reset-password/complete', new NextRequestConstructor('https://example.test/auth/reset-password/complete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        cookie: browser.headerFor('/auth/reset-password/complete'),
      },
      body: JSON.stringify({ password: 'new-password-1' }),
    }));

    expect(completeRes.status).toBe(403);
    // Nothing was cleared: no proof or session deletion headers emitted.
    const completeCookies = getSetCookieHeaders(completeRes);
    expect(completeCookies.some((c) => c.startsWith('rfz-recovery-proof='))).toBe(false);
    expect(completeCookies.some((c) => c.startsWith('rfz-recovery-auth'))).toBe(false);
    // updateUser was never reached.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/v1/user') && (c[1]?.method ?? 'GET').toUpperCase() === 'PUT')).toBe(false);
  });
});
