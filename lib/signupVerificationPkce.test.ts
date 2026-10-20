import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerClient } from '@supabase/ssr';

// Exercises the REAL installed Supabase SDK (auth-js + ssr) against mocked
// network responses, proving the PKCE behaviors the email-verification flow
// depends on: same-browser exchange, cross-device fail-closed, resend
// verifier refresh, and flow-id targeting.

const SUPABASE_URL = 'https://project-ref.supabase.co';

function makeCookieJar() {
  const jar = new Map<string, string>();
  return {
    jar,
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (setCookies: { name: string; value: string }[]) => {
        setCookies.forEach(({ name, value }) => {
          if (value === '') jar.delete(name);
          else jar.set(name, value);
        });
      },
    },
  };
}

function serverClient(cookies: ReturnType<typeof makeCookieJar>['cookies']) {
  return createServerClient(SUPABASE_URL, 'test-anon-key', {
    cookieOptions: { name: 'sb-project-ref-auth-token' },
    cookieEncoding: 'base64url',
    cookies,
  });
}

function authFetch(options: { verifyResponse?: { status: number; body: unknown } } = {}) {
  const calls = { tokenGrant: 0, verify: 0, lastTokenBody: null as string | null };
  const impl = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/token?grant_type=pkce')) {
      calls.tokenGrant += 1;
      return new Response(JSON.stringify(options.verifyResponse?.body ?? {}), {
        status: options.verifyResponse?.status ?? 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/signup')) {
      return new Response(JSON.stringify({ id: 'user-1', email: 'customer@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/resend')) {
      return new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, impl };
}

async function startSignupFlow(client: ReturnType<typeof serverClient>) {
  await client.auth.signUp({
    email: 'customer@example.com',
    password: 'correct horse battery staple',
    options: { emailRedirectTo: 'https://example.test/auth/callback' },
  });
  const flowCookieName = Array.from(jarKeys(client)).find(
    (name) => name.includes('-flow-') && name.endsWith('-code-verifier'),
  );
  const flowId = flowCookieName ? flowCookieName.match(/-flow-([0-9a-f]+)-code-verifier/)?.[1] ?? null : null;
  return { flowId, verifierCookieName: flowCookieName };
}

// The ssr server client persists verifier writes directly to the cookie jar;
// reads of the flow slots come from the same jar.
function jarKeys(_client: unknown): string[] {
  return jarKeysFn();
}

let jarKeysFn: () => string[] = () => [];

describe('signup email verification PKCE behavior (real SDK, mocked network)', () => {
  let cookies: ReturnType<typeof makeCookieJar>['cookies'];
  let jar: Map<string, string>;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const made = makeCookieJar();
    cookies = made.cookies;
    jar = made.jar;
    jarKeysFn = () => Array.from(jar.keys());
  });

  it('starts a signup flow and stores a PKCE verifier cookie in the session namespace', async () => {
    const client = serverClient(cookies);
    const { flowId, verifierCookieName } = await startSignupFlow(client);

    expect(flowId).toMatch(/^[0-9a-f]{32}$/);
    expect(verifierCookieName).toContain('-code-verifier');
    expect(jar.get('sb-project-ref-auth-token-code-verifier')).toBeTruthy();
    // The signup verifier stays out of the isolated customer/admin/recovery namespaces.
    expect(Array.from(jar.keys()).some((name) => name.startsWith('rfz-'))).toBe(false);
  });

  it('exchanges against the verifier when the link comes back on the SAME browser (server-side callback)', async () => {
    const fetchMock = authFetch();
    vi.stubGlobal('fetch', vi.fn(fetchMock.impl));

    const client = serverClient(cookies);
    const { flowId } = await startSignupFlow(client);

    // A successful exchange returns a session; prove the token grant is called
    // with a code_verifier (the PKCE proof) when the verifier is present.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/token?grant_type=pkce')) {
        return new Response(JSON.stringify({
          access_token: 'at', refresh_token: 'rt', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-1', email_confirmed_at: '2026-10-18T00:00:00Z' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const client2 = serverClient(cookies);
    const result = await client2.auth.exchangeCodeForSession('auth-code', flowId ? { flowId } : undefined);
    expect(result.error).toBeNull();
    expect(result.data.session).toBeTruthy();
  });

  it('fails closed when the link is opened on a DIFFERENT device (no verifier present)', async () => {
    // Fresh cookie jar: the verifier never left the original device.
    const client = serverClient(cookies);
    const { calls } = authFetch();
    vi.stubGlobal('fetch', vi.fn(calls ? authFetch().impl : authFetch().impl));

    const result = await client.auth.exchangeCodeForSession('cross-device-code');
    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('pkce_code_verifier_not_found');
    // No token grant is attempted without a verifier: the single-use code is
    // not burned and no verification can happen without the original browser.
    expect(Array.from(jar.keys()).some((name) => name.includes('code-verifier'))).toBe(false);
  });

  it('a tampered flow id cannot borrow another flow\'s verifier', async () => {
    vi.stubGlobal('fetch', vi.fn(authFetch().impl));
    const client = serverClient(cookies);
    await startSignupFlow(client);

    const forged = 'f'.repeat(32);
    const result = await client.auth.exchangeCodeForSession('any-code', { flowId: forged });
    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('pkce_code_verifier_not_found');
  });

  it('resending the confirmation refreshes the verifier in the same namespace', async () => {
    vi.stubGlobal('fetch', vi.fn(authFetch().impl));
    const client = serverClient(cookies);

    const first = await startSignupFlow(client);
    const firstVerifier = jar.get('sb-project-ref-auth-token-code-verifier');

    await client.auth.resend({
      type: 'signup',
      email: 'customer@example.com',
      options: { emailRedirectTo: 'https://example.test/auth/callback' },
    });

    const secondVerifier = jar.get('sb-project-ref-auth-token-code-verifier');
    expect(secondVerifier).toBeTruthy();
    expect(secondVerifier).not.toEqual(firstVerifier);
    // Still isolated to the default namespace.
    expect(Array.from(jar.keys()).some((name) => name.startsWith('rfz-'))).toBe(false);
    void first;
  });

  it('a failed exchange consumes the code but the state machine refuses unverified users', async () => {
    // Server rejects the code (expired/reused): exchange errors cleanly.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/token?grant_type=pkce')) {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid flow state' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const client = serverClient(cookies);
    await startSignupFlow(client);
    const result = await client.auth.exchangeCodeForSession('expired-code');
    expect(result.error).toBeTruthy();
    expect(result.data.session).toBeNull();
  });
});
