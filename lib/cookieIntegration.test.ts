import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash, createHmac, randomBytes } from 'node:crypto';

// Phase 1B-3 integration harness (CHECK 1): REAL @supabase/ssr SDK + REAL
// Next.js route handlers + REAL next/headers cookie plumbing. Only the Auth
// network (fetch) is mocked. Cookie persistence is verified via actual
// Set-Cookie headers on handler responses plus the shared cookie jar the SDK
// itself writes into. The recovery PKCE verifier is seeded exactly the way
// resetPasswordForEmail seeds it in production.

const TEST_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
const ACCESS_TOKEN = 'recovery-access-token-integration';
const USER_ID = 'customer-int-1';
const VERIFIER_KEY = 'rfz-recovery-auth-code-verifier';

const nextCookies = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);
vi.mock('next/headers', () => ({ cookies: vi.fn(() => nextCookies) }));

const cookieJar = new Map<string, string>();

function setCookieHeaders(response: Response): string[] {
  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get('set-cookie') ?? ''].filter(Boolean);
}

function fingerprintOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function makeProof(fingerprint: string, userId = USER_ID): string {
  const claims = {
    token: 'b'.repeat(48),
    userId,
    sessionFingerprint: fingerprint,
    purpose: 'password-reset',
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', TEST_SECRET).update(payload, 'utf8').digest('base64url');
  return `${payload}.${sig}`;
}

function applySetCookies(headers: string[]) {
  for (const header of headers) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '') cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function cookieNames() {
  return Array.from(cookieJar.keys());
}

function reqWithJarCookies(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers ?? {});
  const cookieHeader = Array.from(cookieJar.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest(url, { method: init.method, headers, body: init.body });
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
  return async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.includes('/auth/v1/token')) return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
    if (u.includes('/auth/v1/user') && method === 'GET') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
    if (u.includes('/auth/v1/user') && method === 'PUT') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
    if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
}

async function importHandlers() {
  const { GET: callbackGET } = await import('@/app/auth/callback/route');
  const { POST: completePOST } = await import('@/app/auth/reset-password/complete/route');
  const { POST: loginPOST } = await import('@/app/api/auth/login/route');
  const { POST: registerPOST } = await import('@/app/api/auth/register/route');
  return { callbackGET, completePOST, loginPOST, registerPOST };
}

describe('Phase 1B-3: real SDK + real Next.js cookie plumbing (network mocked)', () => {
  let handlers: Awaited<ReturnType<typeof importHandlers>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    cookieJar.clear();
    nextCookies.getAll.mockImplementation(() => cookieNames().map((name) => ({ name, value: cookieJar.get(name)! })));
    nextCookies.set.mockImplementation((name: string, value: string) => {
      if (value === '') cookieJar.delete(name);
      else cookieJar.set(name, value);
    });
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    handlers = await importHandlers();
  });

  function seedRecoveryVerifier() {
    // Mirrors what resetPasswordForEmail's PKCE flow persists in production:
    // the SDK stores JSON.stringify("<verifier>/recovery") so the exchange
    // resolves redirect type recovery.
    cookieJar.set(VERIFIER_KEY, JSON.stringify(`${randomBytes(32).toString('hex')}/recovery`));
  }

  it('CHECK 1C: recovery callback persists BOTH recovery-namespace session cookies AND the signed proof cookie (real SDK writes)', async () => {
    seedRecoveryVerifier();
    fetchMock.mockImplementation(recoveryNetwork());

    const res = await handlers.callbackGET(reqWithJarCookies('https://example.test/auth/callback?code=rc&type=recovery'));
    const setCookies = setCookieHeaders(res);

    const proofCookie = setCookies.find((c) => c.startsWith('rfz-recovery-proof='));
    expect(proofCookie, `Set-Cookie headers observed: ${JSON.stringify(setCookies)}; jar: ${cookieNames().join(',')}`).toBeDefined();
    expect(proofCookie).toContain('HttpOnly');
    expect(proofCookie).toContain('Max-Age=600');
    expect(proofCookie).toContain('Path=/auth/reset-password');
    expect(proofCookie).not.toContain(ACCESS_TOKEN);

    // The REAL SDK persisted the recovery session through its cookie store.
    expect(cookieNames().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(true);

    // No default/customer/admin namespace cookies were created.
    expect(cookieNames().some((n) => n.startsWith('sb-project-ref-auth-token'))).toBe(false);
    expect(cookieNames().some((n) => n.startsWith('rfz-customer-auth'))).toBe(false);
    expect(cookieNames().some((n) => n.startsWith('rfz-admin-auth'))).toBe(false);
  });

  it('CHECK 1D+1E: completion reads callback-issued cookies, updates the password, signs out and clears the proof cookie in the real response', async () => {
    seedRecoveryVerifier();
    fetchMock.mockImplementation(recoveryNetwork());

    const callbackRes = await handlers.callbackGET(reqWithJarCookies('https://example.test/auth/callback?code=rc&type=recovery'));
    applySetCookies(setCookieHeaders(callbackRes));
    expect(cookieNames().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(true);
    expect(cookieJar.get('rfz-recovery-proof')).toBeDefined();

    const res = await handlers.completePOST(reqWithJarCookies('https://example.test/auth/reset-password/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test' },
      body: JSON.stringify({ password: 'new-password-1' }),
    }));

    expect(res.status).toBe(200);
    const clearedProof = setCookieHeaders(res).find((c) => c.startsWith('rfz-recovery-proof='));
    expect(clearedProof).toBeDefined();
    expect(clearedProof).toContain('Max-Age=0');

    // Real SDK signOut removed the recovery session from the store.
    expect(cookieNames().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/v1/logout'))).toBe(true);

    // Customer/admin/default namespaces remain untouched throughout.
    expect(cookieNames().some((n) => n.startsWith('rfz-customer-auth'))).toBe(false);
    expect(cookieNames().some((n) => n.startsWith('rfz-admin-auth'))).toBe(false);
    expect(cookieNames().some((n) => n.startsWith('sb-project-ref-auth-token'))).toBe(false);
  });

  it('rejection cases: wrong-user proof, wrong-session proof and missing HMAC secret all fail closed without updateUser', async () => {
    seedRecoveryVerifier();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (u.includes('/auth/v1/token')) return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID));
      if (u.includes('/auth/v1/user') && method === 'GET') return jsonResponse(sessionBody(ACCESS_TOKEN, USER_ID).user);
      if (u.includes('/auth/v1/user') && method === 'PUT') throw new Error('updateUser must never be reached');
      if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${u}`);
    });

    const post = (cookie: string) => handlers.completePOST(new NextRequest('https://example.test/auth/reset-password/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test', cookie },
      body: JSON.stringify({ password: 'new-password-1' }),
    }));

    const wrongUserProof = makeProof(fingerprintOf(ACCESS_TOKEN), 'someone-else');
    const resWrongUser = await post(`rfz-recovery-auth=<session>; rfz-recovery-proof=${wrongUserProof}`);
    expect(resWrongUser.status).toBe(403);

    const resWrongSession = await post(`rfz-recovery-auth=<session>; rfz-recovery-proof=${makeProof(fingerprintOf('different-token'))}`);
    expect(resWrongSession.status).toBe(403);

    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;
    const resNoSecret = await post(`rfz-recovery-auth=<session>; rfz-recovery-proof=${makeProof(fingerprintOf(ACCESS_TOKEN))}`);
    expect(resNoSecret.status).toBe(403);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/v1/user') && (c[1]?.method ?? 'GET').toUpperCase() === 'PUT')).toBe(false);
  });

  it('CHECK 1F: recovery cookies stay isolated when customer/admin/default session cookies are already present', async () => {
    seedRecoveryVerifier();
    fetchMock.mockImplementation(recoveryNetwork());
    cookieJar.set('sb-project-ref-auth-token', 'existing-default-session');
    cookieJar.set('rfz-customer-auth', 'existing-customer-session');
    cookieJar.set('rfz-admin-auth', 'existing-admin-session');

    const callbackRes = await handlers.callbackGET(reqWithJarCookies('https://example.test/auth/callback?code=rc&type=recovery'));
    applySetCookies(setCookieHeaders(callbackRes));
    expect(cookieJar.get('rfz-recovery-proof')).toBeDefined();
    expect(cookieNames().some((n) => n.startsWith('rfz-recovery-auth'))).toBe(true);

    const res = await handlers.completePOST(reqWithJarCookies('https://example.test/auth/reset-password/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test' },
      body: JSON.stringify({ password: 'new-password-1' }),
    }));
    expect(res.status).toBe(200);
    expect(cookieJar.get('sb-project-ref-auth-token')).toBe('existing-default-session');
    expect(cookieJar.get('rfz-customer-auth')).toBe('existing-customer-session');
    expect(cookieJar.get('rfz-admin-auth')).toBe('existing-admin-session');
  });

  it('CHECK 1A+2: registration is generic 202 without a session; login activates a pending profile via the real SDK', async () => {
    let signupCalled = false;
    let rpcCalled = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (u.includes('/auth/v1/signup')) { signupCalled = true; return jsonResponse({ user: { id: USER_ID, email: 't@example.test', email_confirmed_at: null }, session: null }); }
      if (u.includes('/auth/v1/token')) return jsonResponse(sessionBody('cus-token', USER_ID));
      if (u.includes('/auth/v1/user') && method === 'GET') return jsonResponse(sessionBody('cus-token', USER_ID).user);
      if (u.includes('/rest/v1/rpc/activate_customer_profile')) { rpcCalled = true; return jsonResponse([{ out_status: 'active', out_error: null }]); }
      if (u.includes('/rest/v1/customer_profiles')) return jsonResponse([{ user_id: USER_ID, status: 'pending_verification' }]);
      if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${u}`);
    });

    const registerRes = await handlers.registerPOST(reqWithJarCookies('https://example.test/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'T', email: 't@example.test', password: 'password123' }),
    }));
    expect(registerRes.status).toBe(202);
    expect(signupCalled).toBe(true);
    expect(cookieNames().some((n) => n.startsWith('rfz-recovery'))).toBe(false);

    const loginRes = await handlers.loginPOST(reqWithJarCookies('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test' },
      body: JSON.stringify({ email: 'user@example.test', password: 'password123' }),
    }));
    expect(loginRes.status).toBe(200);
    expect(rpcCalled).toBe(true);
  });
});
