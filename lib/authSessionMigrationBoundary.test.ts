import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { CUSTOMER_SESSION_COOKIE } from '@/lib/authSessionConfig';

const cookieJar = new Map<string, string>();
const nextCookies = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => nextCookies),
}));

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

function cookieNames() {
  return Array.from(cookieJar.keys());
}

describe('registration and confirmation namespace migration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    nextCookies.getAll.mockImplementation(() => cookieNames().map((name) => ({ name, value: cookieJar.get(name)! })));
    nextCookies.set.mockImplementation((name: string, value: string) => {
      if (value === '') cookieJar.delete(name);
      else cookieJar.set(name, value);
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'pending-user', email: 'customer@example.com' },
      session: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  it('keeps legacy and customer PKCE material in separate storage namespaces', async () => {
    const legacy = await createSupabaseServerClient();
    const result = await legacy.auth.signUp({
      email: 'customer@example.com',
      password: 'correct horse battery staple',
      options: { emailRedirectTo: 'https://example.test/auth/callback' },
    });

    expect(result.error).toBeNull();
    expect(nextCookies.set).toHaveBeenCalled();
    expect(cookieNames().some((name) => name.startsWith('sb-project-ref-auth-token') && name.includes('code-verifier'))).toBe(true);
    expect(cookieNames().some((name) => name.startsWith(`${CUSTOMER_SESSION_COOKIE}-`))).toBe(false);

    cookieJar.clear();
    const customer = await createCustomerServerClient();
    await customer.auth.signUp({
      email: 'customer@example.com',
      password: 'correct horse battery staple',
      options: { emailRedirectTo: 'https://example.test/auth/callback' },
    });
    expect(cookieNames().some((name) => name.startsWith(`${CUSTOMER_SESSION_COOKIE}-`) && name.includes('code-verifier'))).toBe(true);
    expect(cookieNames().some((name) => name.startsWith('sb-project-ref-auth-token') && name.includes('code-verifier'))).toBe(false);
  });

  it('would use the customer PKCE namespace without changing the legacy namespace', async () => {
    const customer = await createCustomerServerClient();
    const auth = customer.auth as unknown as { storageKey: string };

    expect(auth.storageKey).toBe(CUSTOMER_SESSION_COOKIE);
    expect(auth.storageKey).not.toBe('sb-project-ref-auth-token');
  });

  it('does not let a customer-only exchange borrow a legacy verifier', async () => {
    cookieJar.set('sb-project-ref-auth-token-code-verifier', 'legacy-verifier');
    const customer = await createCustomerServerClient();
    const result = await customer.auth.exchangeCodeForSession('synthetic-code');

    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('pkce_code_verifier_not_found');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(cookieNames()).toEqual(['sb-project-ref-auth-token-code-verifier']);
  });

  it('keeps the legacy middleware contract while routing customer confirmation through its namespace', () => {
    const registration = source('app/api/auth/register/route.ts');
    const callback = source('app/auth/callback/route.ts');
    const middleware = source('proxy.ts');

    expect(registration).toContain('createCustomerServerClient');
    expect(registration).not.toContain("from '@/lib/supabaseServer'");
    expect(callback).toContain('createCustomerServerClient');
    expect(callback).not.toContain("from '@/lib/supabaseServer'");
    expect(middleware).toContain("from '@supabase/ssr'");
    expect(middleware).not.toContain('createCustomerServerClient');
    expect(middleware).not.toContain('createAdminServerClient');
  });

  it('does not add a legacy verifier or token-copy fallback to customer paths', () => {
    const customerSession = source('lib/customerSession.ts');
    const login = source('app/api/auth/login/route.ts');
    const logout = source('app/api/auth/logout/route.ts');

    expect(customerSession).toContain('createCustomerServerClient');
    expect(login).toContain('createCustomerServerClient');
    expect(logout).toContain('createCustomerServerClient');
    expect(login).toContain("signOut({ scope: 'local' })");
    expect(logout).toContain("signOut({ scope: 'local' })");
    expect(customerSession).not.toContain('serviceRole');
    expect(login).not.toContain('serviceRole');
    expect(logout).not.toContain('serviceRole');
    expect(login).not.toContain('code_verifier');
    expect(logout).not.toContain('code_verifier');
  });
});
