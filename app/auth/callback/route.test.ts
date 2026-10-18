import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
    },
    rpc: mocks.rpc,
  })),
}));

import { GET } from './route';

function request(query: string) {
  return new NextRequest(`http://request.invalid/auth/callback${query}`);
}

function location(response: Response) {
  return response.headers.get('location');
}

describe('email confirmation callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
  });

  it('exchanges a valid code and activates only the authenticated pending profile', async () => {
    const response = await GET(request('?code=one-time-code&customer_user_id=other-user&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=success');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(location(response)).not.toContain('one-time-code');
    expect(location(response)).not.toContain('evil.example');
  });

  it.each([
    ['missing code', '?customer_user_id=customer-1'],
    ['provider error', '?error=access_denied&error_description=expired'],
  ])('rejects %s without exposing callback details', async (_label, query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await response.text())).not.toContain('expired');
  });

  it.each(['expired', 'reused'])('rejects an %s confirmation code', async (kind) => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: `${kind} provider detail` } });
    const response = await GET(request('?code=secret-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=invalid');
    expect(location(response)).not.toContain('secret-code');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('does not activate when auth.getUser cannot resolve the session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('leaves an unverified user pending and does not call activation', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'customer-1', email_confirmed_at: null } }, error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=pending');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['suspended', 'deactivated'])('does not reactivate a %s profile', async (status) => {
    mocks.rpc.mockResolvedValue({ data: [{ out_status: status, out_error: 'ACCOUNT_RESTRICTED' }], error: null });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=restricted');
    expect(mocks.rpc).toHaveBeenCalledWith('activate_customer_profile');
  });

  it('treats activation and RPC failures as generic errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'provider detail' } });
    const response = await GET(request('?code=valid-code'));
    expect(location(response)).toBe('https://example.test/auth/confirmation?status=error');
    expect((await response.text())).not.toContain('provider detail');
  });

  it('fails closed when the trusted application origin is unavailable', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code'));
    expect(response.status).toBe(503);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('password recovery callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email_confirmed_at: '2026-10-17T12:00:00Z' } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
  });

  it('exchanges a recovery code and redirects to the reset page without activating a profile', async () => {
    const response = await GET(request('?code=recovery-code&type=recovery&next=https%3A%2F%2Fevil.example'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('recovery-code');
    expect(location(response)).not.toContain('evil.example');
  });

  it.each([
    ['missing code', '?type=recovery'],
    ['provider error', '?type=recovery&error=access_denied&error_description=expired'],
  ])('redirects a recovery callback with a %s to the reset page', async (_label, query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('expired');
  });

  it.each(['expired', 'reused', 'invalid'])('redirects a recovery callback with an %s code to the reset page', async (kind) => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: `${kind} provider detail` } });

    const response = await GET(request('?code=secret-code&type=recovery'));

    expect(response.status).toBe(307);
    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(location(response)).not.toContain('secret-code');
    expect(await response.text()).not.toContain('provider detail');
  });

  it('never exposes recovery codes or tokens in the redirect or body', async () => {
    const response = await GET(request('?code=super-secret-code&type=recovery'));

    expect(location(response)).toBe('https://example.test/auth/reset-password');
    expect(location(response)).not.toContain('super-secret-code');
    expect(await response.text()).not.toContain('super-secret-code');
  });

  it('keeps an unknown type on the confirmation path', async () => {
    const response = await GET(request('?code=valid-code&type=unknown'));

    expect(location(response)).toBe('https://example.test/auth/confirmation?status=success');
    expect(mocks.rpc).toHaveBeenCalledWith('activate_customer_profile');
  });

  it('fails closed when the trusted application origin is unavailable during recovery', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await GET(request('?code=valid-code&type=recovery'));
    expect(response.status).toBe(503);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
