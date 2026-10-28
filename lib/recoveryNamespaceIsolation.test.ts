import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createRecoveryServerClient,
  createRecoveryBrowserClient,
} from '@/lib/authSessionClients';
import {
  CUSTOMER_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  RECOVERY_SESSION_COOKIE,
  RECOVERY_PROOF_COOKIE,
  RECOVERY_PROOF_MAX_AGE_SECONDS,
} from '@/lib/authSessionConfig';
import { clearRecoveryProofCookie, isRecoveryProofPresent, newRecoveryProofCookie, sessionFingerprint, verifyRecoveryProof } from '@/lib/recoveryProof';

const cookieJar = new Map<string, string>();
const nextCookies = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => nextCookies),
}));

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

function cookieNames() {
  return Array.from(cookieJar.keys());
}

function token(subject: string, padding = 0, sessionId = '8b8b8b8b-8b8b-48b8-88b8-8b8b8b8b8b8b') {
  const payload = Buffer.from(JSON.stringify({ sub: subject, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600, padding: 'x'.repeat(padding) })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('recovery namespace isolation (real SDK storage behavior, mocked network)', () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });

  it('binds the recovery client to its own storage key, distinct from default, customer and admin', async () => {
    const recovery = await createRecoveryServerClient();
    const auth = recovery.auth as unknown as { storageKey: string };

    expect(auth.storageKey).toBe(RECOVERY_SESSION_COOKIE);
    expect(auth.storageKey).toBe('rfz-recovery-auth');
    expect(auth.storageKey).not.toBe('sb-project-ref-auth-token');
    expect(auth.storageKey).not.toBe(CUSTOMER_SESSION_COOKIE);
    expect(auth.storageKey).not.toBe(ADMIN_SESSION_COOKIE);
  });

  it('stores the recovery PKCE verifier only under the recovery namespace', async () => {
    cookieJar.set(`${RECOVERY_SESSION_COOKIE}-code-verifier`, 'recovery-verifier');

    const recovery = await createRecoveryServerClient();
    await recovery.auth.exchangeCodeForSession('synthetic-code');

    // The verifier is read from the recovery namespace (exchange attempted
    // against it), and no verifier was ever created in default/customer/admin.
    expect(cookieNames()).toContain(`${RECOVERY_SESSION_COOKIE}-code-verifier`);
    expect(cookieNames().some((n) => n.startsWith('sb-project-ref-auth-token') && n.includes('code-verifier'))).toBe(false);
    expect(cookieNames().some((n) => n.startsWith(`${CUSTOMER_SESSION_COOKIE}-`) && n.includes('code-verifier'))).toBe(false);
  });

  it('a default-namespace verifier cannot be consumed by the recovery client (signup cannot become recovery)', async () => {
    cookieJar.set('sb-project-ref-auth-token-code-verifier', 'signup-verifier');
    cookieJar.set(`${CUSTOMER_SESSION_COOKIE}-code-verifier`, 'customer-verifier');
    cookieJar.set(`${ADMIN_SESSION_COOKIE}-code-verifier`, 'admin-verifier');

    const recovery = await createRecoveryServerClient();
    const result = await recovery.auth.exchangeCodeForSession('attacker-code');
    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('pkce_code_verifier_not_found');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      // The foreign verifiers are untouched.
    expect(cookieJar.get('sb-project-ref-auth-token-code-verifier')).toBe('signup-verifier');
    expect(cookieJar.get(`${CUSTOMER_SESSION_COOKIE}-code-verifier`)).toBe('customer-verifier');
    expect(cookieJar.get(`${ADMIN_SESSION_COOKIE}-code-verifier`)).toBe('admin-verifier');
  });

  it('a recovery-namespace verifier cannot be consumed by the default client (recovery cannot activate)', async () => {
    cookieJar.set(`${RECOVERY_SESSION_COOKIE}-code-verifier`, 'recovery-verifier');

    vi.resetModules();
    const { createSupabaseServerClient } = await import('@/lib/supabaseServer');
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.exchangeCodeForSession('recovery-code');

    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('pkce_code_verifier_not_found');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(cookieJar.get(`${RECOVERY_SESSION_COOKIE}-code-verifier`)).toBe('recovery-verifier');
  });

  it('an existing default, customer or admin session never satisfies the recovery browser client', async () => {
    const document = {} as { cookie?: string };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { document } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => Array.from(cookieJar.entries()).map(([name, value]) => `${name}=${value}`).join('; '),
      set: () => {},
    });

    // Realistic sessions in every non-recovery namespace.
    cookieJar.set('sb-project-ref-auth-token.0', token('default-user', 4000));
    cookieJar.set(CUSTOMER_SESSION_COOKIE, token('customer-user'));
    cookieJar.set(ADMIN_SESSION_COOKIE, token('admin-user'));

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));

    const recoveryBrowser = createRecoveryBrowserClient();
    const { data } = await recoveryBrowser.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('recovery proof cookie: signed, expiring, bound to the reset path, clears fully', () => {
    delete (globalThis as { window?: unknown }).window;
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
    try {
      const originalAccessToken = token('customer-1', 0, '9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c');
      const rotatedAccessToken = token('customer-1', 1, '9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c');
      const otherSessionAccessToken = token('customer-1', 0, 'adadadad-adad-4dad-8dad-adadadadadad');
      const binding = { userId: 'customer-1', sessionFingerprint: sessionFingerprint(originalAccessToken)! };
      const proof = newRecoveryProofCookie(binding);
      expect(proof.name).toBe(RECOVERY_PROOF_COOKIE);
      expect(proof.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(proof.options.httpOnly).toBe(true);
      expect(proof.options.secure).toBe(true);
      expect(proof.options.sameSite).toBe('lax');
      expect(proof.options.path).toBe('/auth/reset-password');
      expect(proof.options.maxAge).toBe(RECOVERY_PROOF_MAX_AGE_SECONDS);

      expect(isRecoveryProofPresent({ get: (n: string) => (n === RECOVERY_PROOF_COOKIE ? { value: proof.value } : undefined) })).toBe(true);
      expect(isRecoveryProofPresent({ get: () => undefined })).toBe(false);
      expect(isRecoveryProofPresent({ get: (n: string) => (n === RECOVERY_PROOF_COOKIE ? { value: 'short' } : undefined) })).toBe(false);

      expect(verifyRecoveryProof(proof.value, binding)).toMatchObject({ ok: true, claims: { userId: 'customer-1', purpose: 'password-reset' } });
      expect(sessionFingerprint(rotatedAccessToken)).toBe(binding.sessionFingerprint);
      expect(verifyRecoveryProof(proof.value, { userId: 'other', sessionFingerprint: binding.sessionFingerprint })).toMatchObject({ ok: false, reason: 'user_mismatch' });
      expect(verifyRecoveryProof(proof.value, { userId: 'customer-1', sessionFingerprint: sessionFingerprint(otherSessionAccessToken)! })).toMatchObject({ ok: false, reason: 'session_mismatch' });
      expect(sessionFingerprint('not-a-jwt')).toBeNull();
      expect(verifyRecoveryProof('garbage', binding)).toMatchObject({ ok: false, reason: 'malformed_proof' });

      const cleared = clearRecoveryProofCookie();
      expect(cleared.value).toBe('');
      expect(cleared.options.maxAge).toBe(0);
      expect(cleared.options.expires?.getTime()).toBe(0);
      expect(cleared.options.path).toBe('/auth/reset-password');
    } finally {
      delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;
    }
  });

  it('recovery proof fails closed without a signing secret', () => {
    delete (globalThis as { window?: unknown }).window;
    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;
    const testToken = token('u');
    const fingerprint = sessionFingerprint(testToken)!;
    expect(() => newRecoveryProofCookie({ userId: 'u', sessionFingerprint: fingerprint })).toThrow();
    expect(verifyRecoveryProof('anything', { userId: 'u', sessionFingerprint: fingerprint })).toMatchObject({ ok: false, reason: 'secret_unavailable' });
  });

  it('keeps the recovery flow wired end to end in application code', () => {
    const forgot = source('app/api/auth/forgot-password/route.ts');
    const callback = source('app/auth/callback/route.ts');
    const resetPage = source('app/auth/reset-password/page.tsx');
    const completeRoute = source('app/auth/reset-password/complete/route.ts');

    // Initiation stores the verifier in the recovery namespace.
    expect(forgot).toContain('createRecoveryServerClient');
    expect(forgot).not.toContain('createCustomerServerClient');
    // The callback recovery branch uses the recovery client.
    expect(callback).toContain('createRecoveryServerClient');
    // The password change is executed server-side via the completion route,
    // which re-verifies the recovery user, session and signed proof.
    expect(completeRoute).toContain('createRecoveryServerClient');
    expect(completeRoute).toContain('verifyRecoveryProof');
    expect(completeRoute).toContain('updateUser({ password })');
    // The reset page only posts to the server endpoint; it never calls the
    // Auth provider or touches cookies itself.
    expect(resetPage).toContain("fetch('/auth/reset-password/complete'");
    expect(resetPage).not.toContain('BrowserClient');
    expect(resetPage).not.toContain('auth.updateUser');
    expect(resetPage).not.toContain('document.cookie');
  });
});
