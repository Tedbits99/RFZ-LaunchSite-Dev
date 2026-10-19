import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminBrowserClient,
  createAdminServerClient,
  createCustomerBrowserClient,
  createCustomerServerClient,
} from '@/lib/authSessionClients';
import { ADMIN_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE } from '@/lib/authSessionConfig';

const cookieJar = new Map<string, string>();
const nextCookies = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn(), setAll: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => nextCookies),
}));

function installBrowserDocument() {
  const document = {} as { cookie?: string };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { document } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => Array.from(cookieJar.entries()).map(([name, value]) => `${name}=${value}`).join('; '),
    set: (serialized: string) => {
      const firstPart = serialized.split(';', 1)[0];
      const separator = firstPart.indexOf('=');
      const name = firstPart.slice(0, separator);
      const value = firstPart.slice(separator + 1);
      if (serialized.includes('Max-Age=0')) cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  });
}

function token(subject: string, padding = 0) {
  const payload = Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + 3600, padding: 'x'.repeat(padding) })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('isolated Auth client factories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    nextCookies.getAll.mockImplementation(() => Array.from(cookieJar.entries()).map(([name, value]) => ({ name, value })));
    nextCookies.setAll.mockImplementation((setCookies: { name: string; value: string }[]) => {
      setCookies.forEach(({ name, value }) => cookieJar.set(name, value));
    });
    nextCookies.set.mockImplementation((name: string, value: string) => cookieJar.set(name, value));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        return new Response(JSON.stringify({ access_token: token('refreshed', 8000), refresh_token: 'refreshed-refresh', user: { id: 'synthetic-user', aud: 'authenticated', role: 'authenticated' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(input).endsWith('/user')) {
        return new Response(JSON.stringify({ id: 'synthetic-user', aud: 'authenticated', role: 'authenticated' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    }));
    installBrowserDocument();
  });

  it('uses stable, distinct namespaces and never reuses a browser singleton', () => {
    const customer = createCustomerBrowserClient();
    const admin = createAdminBrowserClient();
    expect(customer).not.toBe(admin);
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(ADMIN_SESSION_COOKIE);
    expect(customer).not.toBe(createCustomerBrowserClient());
    expect(admin).not.toBe(createAdminBrowserClient());
  });

  it('writes and clears only the selected browser namespace, including chunked cookies', async () => {
    const customer = createCustomerBrowserClient();
    const admin = createAdminBrowserClient();

    cookieJar.set(ADMIN_SESSION_COOKIE, 'admin-session');
    const customerSession = await customer.auth.setSession({ access_token: token('customer', 8000), refresh_token: 'customer-refresh' });
    expect(customerSession.error).toBeNull();
    expect(document.cookie).toContain(CUSTOMER_SESSION_COOKIE);
    expect(document.cookie).toContain(ADMIN_SESSION_COOKIE);
    expect(Array.from(cookieJar.keys()).some((name) => name.startsWith(`${CUSTOMER_SESSION_COOKIE}.`))).toBe(true);
    expect(Array.from(cookieJar.keys()).some((name) => name.startsWith(`${ADMIN_SESSION_COOKIE}.`))).toBe(false);

    await admin.auth.setSession({ access_token: token('admin', 8000), refresh_token: 'admin-refresh' });
    expect(document.cookie).toContain(CUSTOMER_SESSION_COOKIE);
    expect(document.cookie).toContain(ADMIN_SESSION_COOKIE);
    expect(Array.from(cookieJar.keys()).some((name) => name.startsWith(`${ADMIN_SESSION_COOKIE}.`))).toBe(true);

    await customer.auth.signOut({ scope: 'local' });
    expect(document.cookie).not.toContain(CUSTOMER_SESSION_COOKIE);
    expect(document.cookie).toContain(ADMIN_SESSION_COOKIE);

    await admin.auth.signOut({ scope: 'local' });
    expect(document.cookie).not.toContain(ADMIN_SESSION_COOKIE);
  });

  it('uses the configured namespace for server cookie reads and writes', () => {
    const customer = createCustomerServerClient();
    const admin = createAdminServerClient();
    expect(customer).not.toBe(admin);

    return Promise.all([
      customer.auth.setSession({ access_token: token('customer'), refresh_token: 'customer-refresh' }),
      admin.auth.setSession({ access_token: token('admin'), refresh_token: 'admin-refresh' }),
    ]).then((results) => {
      expect(results[0].error).toBeNull();
      expect(results[1].error).toBeNull();
      expect(cookieJar.has(CUSTOMER_SESSION_COOKIE)).toBe(true);
      expect(cookieJar.has(ADMIN_SESSION_COOKIE)).toBe(true);
    });
  });

  it('binds refresh-capable Auth clients to their own storage keys', () => {
    const customer = createCustomerBrowserClient();
    const admin = createAdminBrowserClient();
    const customerAuth = customer.auth as unknown as { storageKey: string };
    const adminAuth = admin.auth as unknown as { storageKey: string };
    expect(customerAuth.storageKey).toBe(CUSTOMER_SESSION_COOKIE);
    expect(adminAuth.storageKey).toBe(ADMIN_SESSION_COOKIE);
  });

  it('does not expose a service-role key and keeps both namespaces visible to context selection', () => {
    const customer = createCustomerBrowserClient();
    const admin = createAdminBrowserClient();
    expect(customer).toBeDefined();
    expect(admin).toBeDefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(CUSTOMER_SESSION_COOKIE).toBe('rfz-customer-auth');
    expect(ADMIN_SESSION_COOKIE).toBe('rfz-admin-auth');
  });
});
