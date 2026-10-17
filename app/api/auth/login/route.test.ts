import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
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

  it.each([
    { user: { id: 'customer-1', email_confirmed_at: null }, profile: { user_id: 'customer-1', status: 'active' } },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: null },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'customer-1', status: 'pending_verification' } },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'customer-1', status: 'suspended' } },
    { user: { id: 'customer-1', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { user_id: 'customer-1', status: 'deactivated' } },
  ])('denies an account that is not confirmed and active', async ({ user, profile }) => {
    mocks.getUser.mockResolvedValueOnce({ data: { user }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: profile, error: null });

    const response = await POST(request(validInput));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unable to sign in with those credentials.' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
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
