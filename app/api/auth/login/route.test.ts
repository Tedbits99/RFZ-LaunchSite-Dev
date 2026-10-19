import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  createCustomerServerClient: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: mocks.createCustomerServerClient,
}));

import { GET, POST } from './route';

const origin = 'https://example.test';

function request(body: unknown, method = 'POST', includeOrigin = true) {
  return new NextRequest(`${origin}/api/auth/login`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(includeOrigin ? { origin } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function installClient() {
  mocks.createCustomerServerClient.mockReturnValue({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      getUser: mocks.getUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
      })),
    })),
    rpc: mocks.rpc,
  });
}

const validInput = { email: ' Customer@Example.COM ', password: 'correct horse battery staple' };

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    installClient();
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email: 'customer@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: 'customer-1', status: 'active' }, error: null });
    mocks.rpc.mockResolvedValue({ data: [{ out_status: 'active', out_error: null }], error: null });
  });

  it('authenticates an active confirmed customer through the customer client', async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Signed in.' });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'customer@example.com',
      password: validInput.password,
    });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.createCustomerServerClient).toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: { message: 'Invalid login credentials' } },
    { data: { user: null }, error: { message: 'provider detail' } },
  ])('returns a generic response and clears customer state for Auth failure', async (result) => {
    mocks.signInWithPassword.mockResolvedValueOnce(result);

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unable to sign in with those credentials.' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(JSON.stringify(body)).not.toContain('provider detail');
  });

  it('guides a correct-credentials unconfirmed account to confirm the email (403)', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: 'customer-1', email_confirmed_at: null } },
      error: null,
    });

    const response = await POST(request(validInput));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Please confirm your email address to activate your account.' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('activates a confirmed but pending profile at login through the server-verified RPC', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'customer-1', status: 'pending_verification' }, error: null });

    const response = await POST(request(validInput));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Signed in.' });
    expect(mocks.rpc).toHaveBeenCalledWith('activate_customer_profile');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('never activates a suspended or deactivated profile through the login RPC', async () => {
    for (const outcome of [
      { data: [{ out_status: 'suspended', out_error: 'ACCOUNT_RESTRICTED' }], error: null },
      { data: [{ out_status: 'deactivated', out_error: 'ACCOUNT_RESTRICTED' }], error: null },
      { data: [{ out_status: 'pending_verification', out_error: 'EMAIL_NOT_VERIFIED' }], error: null },
      { data: null, error: { message: 'rpc failed' } },
      { data: null, error: null },
    ]) {
      mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'customer-1', status: 'pending_verification' }, error: null });
      mocks.rpc.mockResolvedValueOnce(outcome);

      const response = await POST(request(validInput));

      expect(response.status).toBe(401);
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    }
  });

  it.each([
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: null },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'other-user', status: 'active' } },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'customer-1', status: 'suspended' } },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'customer-1', status: 'deactivated' } },
  ])('denies an account that is not confirmed-and-active outside the pending path', async ({ user, profile }) => {
    mocks.getUser.mockResolvedValueOnce({ data: { user }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: profile, error: null });

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unable to sign in with those credentials.' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('denies a user lookup failure and cleans up the customer session', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'lookup failed' } });

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rejects invalid input, forged identity fields, and untrusted origins', async () => {
    expect((await POST(request({ email: 'bad', password: 'short', user_id: 'admin', role: 'ADMIN' }))).status).toBe(401);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect((await POST(request(validInput, 'POST', false))).status).toBe(403);
  });

  it('does not expose passwords, tokens, roles, or provider details', async () => {
    const response = await POST(request({ ...validInput, password: 'secret-password', role: 'ADMIN' }));
    const body = await response.text();

    expect(body).not.toContain('secret-password');
    expect(body).not.toContain('ADMIN');
    expect(body).not.toContain('access_token');
  });

  it('supports POST only', async () => {
    expect((await GET()).status).toBe(405);
  });
});
