import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash, createHmac } from 'node:crypto';

const TEST_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
const USER_ID = 'customer-1';
const ACCESS_TOKEN = 'recovery-access-token';

const mocks = vi.hoisted(() => ({
  customerExchangeCodeForSession: vi.fn(),
  customerGetUser: vi.fn(),
  customerRpc: vi.fn(),
  customerVerifyOtp: vi.fn(),
  customerSignOut: vi.fn(),
  recoveryExchangeCodeForSession: vi.fn(),
  recoveryVerifyOtp: vi.fn(),
  recoveryGetUser: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.customerExchangeCodeForSession,
      verifyOtp: mocks.customerVerifyOtp,
      getUser: mocks.customerGetUser,
      signOut: mocks.customerSignOut,
    },
    rpc: mocks.customerRpc,
  })),
  createRecoveryServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.recoveryExchangeCodeForSession,
      verifyOtp: mocks.recoveryVerifyOtp,
      getUser: mocks.recoveryGetUser,
    },
  })),
}));

import { GET } from './route';

function request(query: string) {
  return new NextRequest(`http://request.invalid/auth/callback${query}`);
}

function location(response: Response) {
  return response.headers.get('location');
}

function proofCookie(response: Response): string | undefined {
  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get('set-cookie') ?? ''];
  return cookies.find((c) => c.startsWith('rfz-recovery-proof='));
}

// Documented SDK contract: exchangeCodeForSession returns the session via
// data.session; getUser returns ONLY data.user — never a fabricated
// data.session or top-level session_id.
function recoveryExchangeResult(opts: { accessToken?: string | null } = {}) {
  const accessToken = opts.accessToken === null ? undefined : opts.accessToken ?? ACCESS_TOKEN;
  return {
    data: {
      session: accessToken
        ? { access_token: accessToken, token_type: 'bearer', user: { id: USER_ID } }
        : null,
    },
    error: null,
  };
}

function fingerprintOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function decodeProof(cookie: string) {
  const value = cookie.split(';')[0].split('=')[1];
  const [payload, sig] = value.split('.');
  const expectedSig = createHmac('sha256', TEST_SECRET).update(payload, 'utf8').digest('base64url');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    token: string; userId: string; sessionFingerprint: string; purpose: string; exp: number;
  };
  return { payload, sig, expectedSig, claims, valid: sig === expectedSig };
}

describe('email confirmation callback (customer namespace)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    mocks.customerExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.customerGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.customerRpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
    mocks.customerSignOut.mockResolvedValue({ error: null });
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'no recovery verifier' } });
    mocks.recoveryVerifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'invalid token' } });
    mocks.customerVerifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'invalid token' } });
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('exchanges a valid code and activates only the authenticated pending profile', async () => {
    const response = await GET(request('?code=one-time-code&customer_user_id=other-user&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/account');
    expect(mocks.customerExchangeCodeForSession).toHaveBeenCalledWith('one-time-code', undefined);
    expect(mocks.customerGetUser).toHaveBeenCalledOnce();
    expect(mocks.customerRpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(location(response)).not.toContain('one-time-code');
    expect(location(response)).not.toContain('evil.example');
  });

  it('verifies a documented token_hash email confirmation without a browser PKCE verifier', async () => {
    mocks.customerVerifyOtp.mockResolvedValue({
      data: { session: { user: { id: 'customer-1' } } },
      error: null,
    });

    const response = await GET(request('?token_hash=opaque-confirmation-token&type=email'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/account');
    expect(mocks.customerVerifyOtp).toHaveBeenCalledWith({ token_hash: 'opaque-confirmation-token', type: 'email' });
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(location(response)).not.toContain('opaque-confirmation-token');
    expect(await response.text()).not.toContain('opaque-confirmation-token');
  });

  it('uses only the customer client on the confirmation path (never the recovery client)', async () => {
    await GET(request('?code=one-time-code'));

    expect(mocks.customerExchangeCodeForSession).toHaveBeenCalled();
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.recoveryGetUser).not.toHaveBeenCalled();
  });

  it.each([
    ['missing code', '?customer_user_id=customer-1'],
    ['provider error', '?error=access_denied&error_description=expired'],
  ])('rejects %s without exposing callback details', async (_label, query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect((await response.text())).not.toContain('expired');
  });

  it('rejects an unsupported token_hash confirmation type before verification', async () => {
    const response = await GET(request('?token_hash=opaque-confirmation-token&type=unknown'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(mocks.customerVerifyOtp).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('opaque-confirmation-token');
  });

  it.each(['expired', 'reused'])('rejects an %s confirmation code', async (kind) => {
    mocks.customerExchangeCodeForSession.mockResolvedValue({ error: { message: `${kind} provider detail` } });
    const response = await GET(request('?code=secret-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(location(response)).not.toContain('secret-code');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('does not activate when auth.getUser cannot resolve the session', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect(mocks.customerRpc).not.toHaveBeenCalled();
  });

  it('leaves an unverified user pending and does not call activation', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: { id: 'customer-1', email_confirmed_at: null } }, error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=pending');
    expect(mocks.customerRpc).not.toHaveBeenCalled();
  });

  it.each(['suspended', 'deactivated'])('does not reactivate a %s profile', async (status) => {
    mocks.customerRpc.mockResolvedValue({ data: [{ out_status: status, out_error: 'ACCOUNT_RESTRICTED' }], error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=restricted');
    expect(mocks.customerRpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(mocks.customerSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('treats activation and RPC failures as generic errors', async () => {
    mocks.customerRpc.mockResolvedValueOnce({ data: null, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('fails closed when the trusted application origin is unavailable', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code'));
    expect(response.status).toBe(503);
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('password recovery callback (recovery namespace isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    mocks.customerExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.customerGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.customerRpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
    mocks.recoveryExchangeCodeForSession.mockResolvedValue(recoveryExchangeResult());
    // getUser returns ONLY data.user — the SDK contract.
    mocks.recoveryGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email_confirmed_at: null } },
      error: null,
    });
  });

  it('exchanges a recovery code via the RECOVERY client and issues a signed proof cookie', async () => {
    const response = await GET(request('?code=recovery-code&type=recovery&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.recoveryExchangeCodeForSession).toHaveBeenCalledWith('recovery-code', undefined);
    expect(mocks.recoveryGetUser).toHaveBeenCalledOnce();
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('recovery-code');
    expect(location(response)).not.toContain('evil.example');

    const proof = proofCookie(response);
    expect(proof).toBeDefined();
    expect(proof).toContain('HttpOnly');
    expect(proof).toContain('Max-Age=600');
    expect(proof).toContain('Path=/auth/reset-password');

    const decoded = decodeProof(proof!);
    expect(decoded.valid).toBe(true);
    expect(decoded.claims.userId).toBe(USER_ID);
    expect(decoded.claims.sessionFingerprint).toBe(fingerprintOf(ACCESS_TOKEN));
    expect(decoded.claims.purpose).toBe('password-reset');
    expect(decoded.claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(decoded.claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 600);
  });

  it('supports a Supabase token_hash recovery link without a browser PKCE verifier', async () => {
    mocks.recoveryVerifyOtp.mockResolvedValue({
      data: { session: { access_token: ACCESS_TOKEN, user: { id: USER_ID } } },
      error: null,
    });

    const response = await GET(request('?token_hash=opaque-token&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.recoveryVerifyOtp).toHaveBeenCalledWith({ token_hash: 'opaque-token', type: 'recovery' });
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
    expect(proofCookie(response)).toBeDefined();
    expect(location(response)).not.toContain('opaque-token');
  });

  it('issues the proof even when getUser() returns ONLY data.user (no data.session)', async () => {
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await GET(request('?code=recovery-code&type=recovery'));

    expect(proofCookie(response)).toBeDefined();
  });

  it('never activates a profile or calls activation RPC from the recovery branch', async () => {
    await GET(request('?code=recovery-code&type=recovery'));

    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(mocks.customerGetUser).not.toHaveBeenCalled();
  });

  it('fails closed when the recovery exchange errors (no proof cookie issued)', async () => {
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired provider detail' } });

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
    expect(mocks.recoveryGetUser).not.toHaveBeenCalled();
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('secret-code');
    expect(await response.text()).not.toContain('provider detail');
  });

  it('fails closed when the exchange succeeds but returns no access token', async () => {
    mocks.recoveryExchangeCodeForSession.mockResolvedValue(recoveryExchangeResult({ accessToken: null }));

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
    expect(mocks.recoveryGetUser).not.toHaveBeenCalled();
  });

  it('fails closed when the recovery exchange succeeds but no user resolves', async () => {
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
  });

  it('fails closed when getUser() returns a different user than the exchange session', async () => {
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
  });

  it('fails closed when the proof signing secret is missing (no proof cookie)', async () => {
    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;

    const response = await GET(request('?code=recovery-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
  });

  it.each([
    ['missing code', '?type=recovery'],
    ['provider error', '?type=recovery&error=access_denied&error_description=expired'],
  ])('redirects a recovery callback with a %s to the reset page without a proof', async (_label, query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(proofCookie(response)).toBeUndefined();
    expect(await response.text()).not.toContain('expired');
  });

  it('a signup confirmation code cannot authorize password reset by adding type=recovery', async () => {
    // The signup code has a verifier only in the customer namespace; the
    // recovery client has no verifier, so the recovery exchange fails closed.
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { code: 'pkce_code_verifier_not_found' } });

    const response = await GET(request('?code=signup-code&type=recovery'));

    expect(mocks.recoveryExchangeCodeForSession).toHaveBeenCalledWith('signup-code', undefined);
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(proofCookie(response)).toBeUndefined();
  });

  it('a genuine recovery URL edited to a non-recovery type cannot activate a profile', async () => {
    // Recovery verifier exists only in the recovery namespace; the customer
    // client's exchange fails, so no activation occurs.
    mocks.customerExchangeCodeForSession.mockResolvedValue({ data: null, error: { code: 'pkce_code_verifier_not_found' } });

    const response = await GET(request('?code=recovery-code&type=signup'));

    expect(mocks.customerExchangeCodeForSession).toHaveBeenCalledWith('recovery-code', undefined);
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
  });

  it('rejects unknown confirmation types without activating a profile', async () => {
    const response = await GET(request('?code=valid-code&type=unknown'));

    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(mocks.customerExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.customerRpc).not.toHaveBeenCalled();
  });

  it('never exposes recovery codes or tokens in the redirect or body', async () => {
    const response = await GET(request('?code=super-secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(location(response)).not.toContain('super-secret-code');
    expect(await response.text()).not.toContain('super-secret-code');

    const proof = proofCookie(response);
    expect(proof).toBeDefined();
    expect(proof).not.toContain('super-secret-code');
    expect(proof).not.toContain(ACCESS_TOKEN);
  });

  it('fails closed when the trusted application origin is unavailable during recovery', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code&type=recovery'));
    expect(response.status).toBe(503);
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
