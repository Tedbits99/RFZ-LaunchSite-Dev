import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  defaultExchangeCodeForSession: vi.fn(),
  defaultGetUser: vi.fn(),
  defaultRpc: vi.fn(),
  recoveryExchangeCodeForSession: vi.fn(),
  recoveryGetUser: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.defaultExchangeCodeForSession,
      getUser: mocks.defaultGetUser,
    },
    rpc: mocks.defaultRpc,
  })),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createRecoveryServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.recoveryExchangeCodeForSession,
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

describe('email confirmation callback (default namespace)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    mocks.defaultExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.defaultGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.defaultRpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'no recovery verifier' } });
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('exchanges a valid code and activates only the authenticated pending profile', async () => {
    const response = await GET(request('?code=one-time-code&customer_user_id=other-user&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=success');
    expect(mocks.defaultExchangeCodeForSession).toHaveBeenCalledWith('one-time-code', undefined);
    expect(mocks.defaultGetUser).toHaveBeenCalledOnce();
    expect(mocks.defaultRpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(location(response)).not.toContain('one-time-code');
    expect(location(response)).not.toContain('evil.example');
  });

  it('uses only the default client on the confirmation path (never the recovery client)', async () => {
    await GET(request('?code=one-time-code'));

    expect(mocks.defaultExchangeCodeForSession).toHaveBeenCalled();
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
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect((await response.text())).not.toContain('expired');
  });

  it.each(['expired', 'reused'])('rejects an %s confirmation code', async (kind) => {
    mocks.defaultExchangeCodeForSession.mockResolvedValue({ error: { message: `${kind} provider detail` } });
    const response = await GET(request('?code=secret-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(location(response)).not.toContain('secret-code');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('does not activate when auth.getUser cannot resolve the session', async () => {
    mocks.defaultGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
  });

  it('leaves an unverified user pending and does not call activation', async () => {
    mocks.defaultGetUser.mockResolvedValue({ data: { user: { id: 'customer-1', email_confirmed_at: null } }, error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=pending');
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
  });

  it.each(['suspended', 'deactivated'])('does not reactivate a %s profile', async (status) => {
    mocks.defaultRpc.mockResolvedValue({ data: [{ out_status: status, out_error: 'ACCOUNT_RESTRICTED' }], error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=restricted');
    expect(mocks.defaultRpc).toHaveBeenCalledWith('activate_customer_profile');
  });

  it('treats activation and RPC failures as generic errors', async () => {
    mocks.defaultRpc.mockResolvedValueOnce({ data: null, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('fails closed when the trusted application origin is unavailable', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code'));
    expect(response.status).toBe(503);
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('password recovery callback (recovery namespace isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    mocks.defaultExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.defaultGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.defaultRpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.recoveryGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
  });

  it('exchanges a recovery code via the RECOVERY client and issues the proof cookie', async () => {
    const response = await GET(request('?code=recovery-code&type=recovery&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.recoveryExchangeCodeForSession).toHaveBeenCalledWith('recovery-code', undefined);
    expect(mocks.recoveryGetUser).toHaveBeenCalledOnce();
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('recovery-code');
    expect(location(response)).not.toContain('evil.example');

    const proof = proofCookie(response);
    expect(proof).toBeDefined();
    expect(proof).toContain('HttpOnly');
    expect(proof).toContain('Max-Age=600');
    expect(proof).toContain('Path=/auth/reset-password');
  });

  it('never activates a profile or calls activation RPC from the recovery branch', async () => {
    await GET(request('?code=recovery-code&type=recovery'));

    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(mocks.defaultGetUser).not.toHaveBeenCalled();
  });

  it('fails closed when the recovery exchange errors (no proof cookie issued)', async () => {
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'expired provider detail' } });

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(proofCookie(response)).toBeUndefined();
    expect(mocks.recoveryGetUser).not.toHaveBeenCalled();
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('secret-code');
    expect(await response.text()).not.toContain('provider detail');
  });

  it('fails closed when the recovery exchange succeeds but no user resolves', async () => {
    mocks.recoveryGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    const response = await GET(request('?code=secret-code&type=recovery'));

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
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(proofCookie(response)).toBeUndefined();
    expect(await response.text()).not.toContain('expired');
  });

  it('a signup confirmation code cannot authorize password reset by adding type=recovery', async () => {
    // The signup code has a verifier only in the DEFAULT namespace; the
    // recovery client has no verifier, so the recovery exchange fails closed.
    mocks.recoveryExchangeCodeForSession.mockResolvedValue({ data: null, error: { code: 'pkce_code_verifier_not_found' } });

    const response = await GET(request('?code=signup-code&type=recovery'));

    expect(mocks.recoveryExchangeCodeForSession).toHaveBeenCalledWith('signup-code', undefined);
    expect(mocks.defaultExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(proofCookie(response)).toBeUndefined();
  });

  it('a genuine recovery URL edited to a non-recovery type cannot activate a profile', async () => {
    // Recovery verifier exists only in the recovery namespace; the default
    // client's exchange fails, so no activation occurs.
    mocks.defaultExchangeCodeForSession.mockResolvedValue({ data: null, error: { code: 'pkce_code_verifier_not_found' } });

    const response = await GET(request('?code=recovery-code&type=signup'));

    expect(mocks.defaultExchangeCodeForSession).toHaveBeenCalledWith('recovery-code', undefined);
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.defaultRpc).not.toHaveBeenCalled();
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
  });

  it('keeps an unknown type on the confirmation path', async () => {
    const response = await GET(request('?code=valid-code&type=unknown'));

    expect(location(response)).toBe('https://example.test/auth/confirmation?status=success');
    expect(mocks.defaultRpc).toHaveBeenCalledWith('activate_customer_profile');
  });

  it('never exposes recovery codes or tokens in the redirect or body', async () => {
    const response = await GET(request('?code=super-secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(location(response)).not.toContain('super-secret-code');
    expect(await response.text()).not.toContain('super-secret-code');
  });

  it('fails closed when the trusted application origin is unavailable during recovery', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code&type=recovery'));
    expect(response.status).toBe(503);
    expect(mocks.recoveryExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
