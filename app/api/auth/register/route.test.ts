import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: vi.fn(() => ({
    auth: { signUp: mocks.signUp, signOut: mocks.signOut },
  })),
}));

import { GET, POST } from './route';

const validInput = {
  email: 'customer@example.com',
  password: 'correct horse battery staple',
  name: 'Customer One',
};

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/auth/register', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

describe('customer registration route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: null }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it('accepts valid input without manually creating or activating a profile', async () => {
    const response = await POST(request(validInput));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message: 'If the address can receive mail, confirmation instructions will be sent.',
    });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: validInput.email,
      password: validInput.password,
      options: {
        emailRedirectTo: 'https://example.test/auth/callback',
        data: { full_name: validInput.name },
      },
    });
  });

  it('supports the existing HTML form encoding', async () => {
    const form = new FormData();
    form.set('email', validInput.email);
    form.set('password', validInput.password);
    form.set('name', validInput.name);
    const response = await POST(new NextRequest('http://localhost/api/auth/register', { method: 'POST', body: form }));
    expect(response.status).toBe(202);
    expect(mocks.signUp).toHaveBeenCalled();
  });

  it.each([
    { email: 'invalid', password: validInput.password, name: validInput.name },
    { email: validInput.email, password: 'short', name: validInput.name },
    { email: validInput.email, password: validInput.password, name: '' },
    {},
  ])('rejects invalid input before calling Auth', async (input) => {
    const response = await POST(request(input));
    expect(response.status).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('uses an enumeration-safe response for duplicate accounts', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', status: 422, message: 'provider detail' },
    });
    const response = await POST(request(validInput));
    expect(response.status).toBe(202);
    const body = await response.text();
    expect(body).not.toContain('customer@example.com');
    expect(body).not.toContain('provider detail');
  });

  it('returns a generic server error for Auth failures without leaking details', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 500, message: 'secret provider detail' },
    });
    const response = await POST(request(validInput));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain('secret provider detail');
    expect(body).not.toContain(validInput.password);
  });

  it('fails closed when Auth returns a session before email confirmation', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: { access_token: 'secret-token' } }, error: null });
    const response = await POST(request(validInput));
    expect(response.status).toBe(503);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect((await response.text())).not.toContain('secret-token');
  });

  it('returns 503 when Supabase configuration is unavailable', async () => {
    const { createCustomerServerClient } = await import('@/lib/authSessionClients');
    vi.mocked(createCustomerServerClient).mockImplementationOnce(() => { throw new Error('missing configuration'); });
    const response = await POST(request(validInput));
    expect(response.status).toBe(503);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('rejects non-POST requests', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});
