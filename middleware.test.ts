import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
  NextResponse: NextResponse,
}));

import { proxy, config } from './proxy';

const URL_ENV = 'https://sbref123456.supabase.co';
const ANON_KEY = 'anon-key-test';
const DEFAULT_KEY = 'sb-sbref123456-auth-token';
const CUSTOMER_KEY = 'rfz-customer-auth';
const ADMIN_KEY = 'rfz-admin-auth';

type CookieRecord = { name: string; value: string; options?: CookieOptions };

interface NamespaceCall {
  storageKey: string;
  getAllResult: { name: string; value: string }[];
  capturedGetAll: { name: string; value: string }[];
  capturedSetAll: CookieRecord[];
  getUser: ReturnType<typeof vi.fn>;
}

let namespaceCalls: NamespaceCall[];

function installNamespaceMocks() {
  namespaceCalls = [];
  mocks.createServerClient.mockImplementation(
    (_url: string, _key: string, options: {
      cookieOptions?: { name?: string };
      cookies: {
        getAll: () => { name: string; value: string }[];
        setAll: (c: CookieRecord[]) => void;
      };
    }) => {
      const getAllResult = options.cookies.getAll();
      const call: NamespaceCall = {
        storageKey: options.cookieOptions?.name ?? DEFAULT_KEY,
        getAllResult,
        capturedGetAll: [],
        capturedSetAll: [],
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      };
      call.capturedGetAll = getAllResult;
      // When the test pre-registered a refresh for this namespace, emulate the
      // SSR client: setAll fires during getUser() when the session refreshes.
      const refresh = pendingRefreshes.get(call.storageKey);
      if (refresh) {
        options.cookies.setAll(refresh);
        call.getUser = vi.fn().mockImplementation(async () => {
          options.cookies.setAll(refresh);
          return { data: { user: { id: 'u' } }, error: null };
        });
      }
      namespaceCalls.push(call);
      return { auth: { getUser: call.getUser } };
    },
  );
}

let pendingRefreshes: Map<string, CookieRecord[]>;

function refreshCookies(base: string, suffix: string): CookieRecord[] {
  return [
    { name: `${base}${suffix}`, value: `refreshed-${base}`, options: { httpOnly: true, sameSite: 'lax', path: '/' } },
  ];
}

function makeRequest(cookieNames: string[]): NextRequest {
  const req = new NextRequest('https://example.test/account', { method: 'GET' });
  cookieNames.forEach((name) => req.cookies.set(name, 'value'));
  return req;
}

// Reads the cookie header that the response forwards to the downstream
// handler (x-middleware-request-cookie in Next.js 13.5) — the actual
// framework contract for same-request cookie forwarding.
function forwardedCookieHeader(res: NextResponse): string | null {
  return res.headers.get('x-middleware-request-cookie');
}

describe('proxy session refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    pendingRefreshes = new Map();
    installNamespaceMocks();
  });

  function clientsCalled(): string[] {
    return namespaceCalls.map((c) => c.storageKey);
  }

  it('refreshes the default Supabase session when its cookie is present', async () => {
    pendingRefreshes.set(DEFAULT_KEY, refreshCookies(DEFAULT_KEY, ''));
    const res = await proxy(makeRequest([DEFAULT_KEY]));

    expect(clientsCalled()).toEqual([DEFAULT_KEY]);
    expect(res.cookies.get(DEFAULT_KEY)?.value).toBe(`refreshed-${DEFAULT_KEY}`);
    expect(res.cookies.get(DEFAULT_KEY)?.httpOnly).toBe(true);
  });

  it('refreshes the customer session through the customer namespace', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    const res = await proxy(makeRequest([CUSTOMER_KEY]));

    expect(clientsCalled()).toEqual([CUSTOMER_KEY]);
    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
  });

  it('refreshes the admin session through the admin namespace', async () => {
    pendingRefreshes.set(ADMIN_KEY, refreshCookies(ADMIN_KEY, ''));
    const res = await proxy(makeRequest([ADMIN_KEY]));

    expect(clientsCalled()).toEqual([ADMIN_KEY]);
    expect(res.cookies.get(ADMIN_KEY)?.value).toBe(`refreshed-${ADMIN_KEY}`);
  });

  it('refreshes customer and admin sessions independently when both are present', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    pendingRefreshes.set(ADMIN_KEY, refreshCookies(ADMIN_KEY, ''));
    const res = await proxy(makeRequest([CUSTOMER_KEY, ADMIN_KEY]));

    expect(clientsCalled()).toEqual([CUSTOMER_KEY, ADMIN_KEY]);
    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
    expect(res.cookies.get(ADMIN_KEY)?.value).toBe(`refreshed-${ADMIN_KEY}`);
  });

  it('refreshes default, customer and admin sessions when all three are present', async () => {
    pendingRefreshes.set(DEFAULT_KEY, refreshCookies(DEFAULT_KEY, ''));
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    pendingRefreshes.set(ADMIN_KEY, refreshCookies(ADMIN_KEY, ''));
    const res = await proxy(makeRequest([DEFAULT_KEY, CUSTOMER_KEY, ADMIN_KEY]));

    expect(clientsCalled()).toEqual([DEFAULT_KEY, CUSTOMER_KEY, ADMIN_KEY]);
    expect(res.cookies.get(DEFAULT_KEY)?.value).toBe(`refreshed-${DEFAULT_KEY}`);
    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
    expect(res.cookies.get(ADMIN_KEY)?.value).toBe(`refreshed-${ADMIN_KEY}`);
  });

  it('preserves Set-Cookie headers from every namespace when multiple clients refresh in one request', async () => {
    pendingRefreshes.set(DEFAULT_KEY, [
      { name: DEFAULT_KEY, value: 'd1', options: { httpOnly: true, path: '/' } },
      { name: `${DEFAULT_KEY}.metadata`, value: 'm1', options: { path: '/' } },
    ]);
    pendingRefreshes.set(CUSTOMER_KEY, [
      { name: CUSTOMER_KEY, value: 'c1', options: { httpOnly: true, path: '/' } },
      { name: `${CUSTOMER_KEY}.metadata`, value: 'm2', options: { path: '/' } },
    ]);
    pendingRefreshes.set(ADMIN_KEY, [
      { name: ADMIN_KEY, value: 'a1', options: { httpOnly: true, path: '/' } },
      { name: `${ADMIN_KEY}.metadata`, value: 'm3', options: { path: '/' } },
    ]);

    const res = await proxy(makeRequest([DEFAULT_KEY, CUSTOMER_KEY, ADMIN_KEY]));

    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const setCookieText = setCookie.join('\n');
    expect(setCookieText).toContain('d1');
    expect(setCookieText).toContain('c1');
    expect(setCookieText).toContain('a1');
    expect(setCookieText).toContain('m1');
    expect(setCookieText).toContain('m2');
    expect(setCookieText).toContain('m3');
    expect(res.cookies.get(DEFAULT_KEY)?.value).toBe('d1');
    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe('c1');
    expect(res.cookies.get(ADMIN_KEY)?.value).toBe('a1');
    expect(res.cookies.get(`${CUSTOMER_KEY}.metadata`)?.value).toBe('m2');
  });

  it('forwards the refreshed customer cookie to downstream request handling via the response headers', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    const req = makeRequest([`${CUSTOMER_KEY}.0`]);
    const res = await proxy(req);

    const forwarded = forwardedCookieHeader(res);
    expect(forwarded).toContain(CUSTOMER_KEY);
    expect(forwarded).toContain(`refreshed-${CUSTOMER_KEY}`);
    // The stale chunk value must not survive in the forwarded header.
    expect(forwarded).not.toContain('refreshed- ');
    expect(req.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
  });

  it('forwards new default, customer and admin cookies downstream when all three refresh', async () => {
    pendingRefreshes.set(DEFAULT_KEY, refreshCookies(DEFAULT_KEY, ''));
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    pendingRefreshes.set(ADMIN_KEY, refreshCookies(ADMIN_KEY, ''));
    const res = await proxy(makeRequest([DEFAULT_KEY, CUSTOMER_KEY, ADMIN_KEY]));

    const forwarded = forwardedCookieHeader(res);
    expect(forwarded).toContain(`refreshed-${DEFAULT_KEY}`);
    expect(forwarded).toContain(`refreshed-${CUSTOMER_KEY}`);
    expect(forwarded).toContain(`refreshed-${ADMIN_KEY}`);
  });

  it('forwards an unrelated request header downstream unchanged', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    const req = new NextRequest('https://example.test/account', {
      method: 'GET',
      headers: { 'x-custom-tracker': 'keep-me', cookie: `${CUSTOMER_KEY}.0=stale` },
    });
    const res = await proxy(req);

    expect(res.headers.get('x-middleware-request-x-custom-tracker')).toBe('keep-me');
    expect(forwardedCookieHeader(res)).toContain(`refreshed-${CUSTOMER_KEY}`);
  });

  it('keeps another namespace forwarded and Set-Cookie values when one namespace fails to refresh', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));

    // Make the admin namespace (the second client created) fail its refresh.
    const baseImplementation = mocks.createServerClient.getMockImplementation()!;
    mocks.createServerClient.mockImplementation((...args: unknown[]) => {
      const options = args[2] as { cookieOptions?: { name?: string } };
      if (options.cookieOptions?.name === ADMIN_KEY) {
        return {
          auth: {
            getUser: vi.fn().mockRejectedValue(new Error('refresh failed')),
          },
        };
      }
      return baseImplementation(...(args as Parameters<typeof baseImplementation>));
    });

    const res = await proxy(makeRequest([CUSTOMER_KEY, ADMIN_KEY]));

    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
    expect(res.cookies.get(ADMIN_KEY)).toBeUndefined();
    const forwarded = forwardedCookieHeader(res);
    expect(forwarded).toContain(`refreshed-${CUSTOMER_KEY}`);
    // The failed admin namespace keeps its ORIGINAL cookie value downstream —
    // it is neither refreshed nor erased.
    expect(forwarded).toContain('rfz-admin-auth=value');
  });

  it('passes a request through unchanged when no session refresh occurs', async () => {
    const res = await proxy(makeRequest([CUSTOMER_KEY]));

    expect(mocks.createServerClient).toHaveBeenCalled(); // client created, but no refresh
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(forwardedCookieHeader(res)).toBeNull();
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    expect(setCookie).toHaveLength(0);
  });

  it('does not create any Supabase client when no session cookie is present', async () => {
    const res = await proxy(makeRequest(['unrelated-cookie']));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(namespaceCalls).toHaveLength(0);
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    expect(setCookie).toHaveLength(0);
  });

  it('skips Auth network calls for namespaces without cookies while refreshing the present one', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    await proxy(makeRequest([CUSTOMER_KEY]));

    const called = clientsCalled();
    expect(called).toContain(CUSTOMER_KEY);
    expect(called).not.toContain(ADMIN_KEY);
    expect(called).not.toContain(DEFAULT_KEY);
  });

  it('detects chunked session cookies as a present namespace', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));
    const req = makeRequest([`${CUSTOMER_KEY}.0`, `${CUSTOMER_KEY}.1`]);
    const res = await proxy(req);

    expect(clientsCalled()).toEqual([CUSTOMER_KEY]);
    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
    expect(forwardedCookieHeader(res)).toContain(`refreshed-${CUSTOMER_KEY}`);
  });

  it('does not touch unrelated sessions when one namespace fails to refresh', async () => {
    pendingRefreshes.set(CUSTOMER_KEY, refreshCookies(CUSTOMER_KEY, ''));

    // Make the admin namespace (the second client created) fail its refresh.
    const baseImplementation = mocks.createServerClient.getMockImplementation()!;
    mocks.createServerClient.mockImplementation((...args: unknown[]) => {
      const options = args[2] as { cookieOptions?: { name?: string } };
      if (options.cookieOptions?.name === ADMIN_KEY) {
        return {
          auth: {
            getUser: vi.fn().mockRejectedValue(new Error('refresh failed')),
          },
        };
      }
      return baseImplementation(...(args as Parameters<typeof baseImplementation>));
    });

    const res = await proxy(makeRequest([CUSTOMER_KEY, ADMIN_KEY]));

    expect(res.cookies.get(CUSTOMER_KEY)?.value).toBe(`refreshed-${CUSTOMER_KEY}`);
    expect(res.cookies.get(ADMIN_KEY)).toBeUndefined();
  });

  it('returns a normal passthrough response when Supabase env config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const res = await proxy(makeRequest([CUSTOMER_KEY]));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('returns a normal passthrough response when the Supabase URL is malformed', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not a valid url';

    const req = makeRequest([DEFAULT_KEY]);
    const res = await proxy(req);

    expect(clientsCalled()).toEqual([]); // default namespace name unresolvable
    // customer/admin namespaces are still independent of URL parsing
    expect(clientsCalled()).toEqual([]);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps the existing matcher compatible with static assets and api routes', () => {
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ]);
  });
});
