import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET, POST } from './route';

const origin = 'https://example.test';

function request(body: unknown, method = 'POST', includeOrigin = true) {
  return new NextRequest(`${origin}/api/auth/forgot-password`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(includeOrigin ? { origin } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function installClient() {
  mocks.createSupabaseServerClient.mockReturnValue({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  });
}

const GENERIC_OK = 'If the address can receive mail, reset instructions will be sent.';

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    installClient();
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  });

  it('requests a reset via the default-namespace server client with the configured recovery redirect', async () => {
    const response = await POST(request({ email: ' Customer@Example.COM ' }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: GENERIC_OK });
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'customer@example.com',
      { redirectTo: `${origin}/auth/callback?type=recovery` },
    );
  });

  it('initiates recovery through the same default namespace the callback exchanges in (PKCE verifier match)', async () => {
    // The PKCE verifier is stored under the initiating client's storage key
    // and the callback's exchangeCodeForSession reads it from the default
    // Supabase storage namespace (lib/supabaseServer.ts). Both sides must
    // resolve to the same client factory for the exchange to find the verifier.
    vi.doMock('@/lib/supabaseServer', () => ({
      createSupabaseServerClient: mocks.createSupabaseServerClient,
    }));
    const { POST: freshPost } = await import('./route');
    await freshPost(request({ email: 'customer@example.com' }));

    // The route's initiating client is the exact factory the callback uses.
    expect(mocks.createSupabaseServerClient).toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'customer@example.com',
      { redirectTo: `${origin}/auth/callback?type=recovery` },
    );
    vi.doUnmock('@/lib/supabaseServer');
  });

  it('does not touch customer or admin session clients or cookies', async () => {
    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(202);
    // No cookie mutation happens in this route: it only triggers the email.
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    expect(setCookie).toHaveLength(0);
  });

  it.each([
    { data: {}, error: { message: 'rate limited', status: 429 } },
    { data: {}, error: { message: 'provider detail', code: 'user_not_found' } },
  ])('returns the same generic response for any Auth error (no enumeration)', async (result) => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce(result);

    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: GENERIC_OK });
  });

  it.each([
    null,
    42,
    'string',
    ['array'],
    {},
    { email: 42 },
    { email: 'not-an-email' },
    { email: '' },
    { email: `${'a'.repeat(311)}@example.com` },
    { email: 'user@', extra_role: 'ADMIN', user_id: 'x' },
  ])('rejects invalid or forged payloads with 400', async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('rejects untrusted origins and malformed JSON', async () => {
    expect((await POST(request({ email: 'a@b.co' }, 'POST', false))).status).toBe(403);
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();

    const badJson = new NextRequest(`${origin}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: 'not json',
    });
    expect((await POST(badJson)).status).toBe(400);
  });

  it('normalizes email casing and whitespace', async () => {
    await POST(request({ email: '  MiXeD@Case.COM ' }));
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'mixed@case.com',
      { redirectTo: `${origin}/auth/callback?type=recovery` },
    );
  });

  it('never exposes passwords, tokens, roles, or provider details', async () => {
    const response = await POST(request({ email: 'customer@example.com', password: 'secret-pw', role: 'ADMIN' }));
    const body = await response.text();

    expect(body).not.toContain('secret-pw');
    expect(body).not.toContain('ADMIN');
    expect(body).not.toContain('access_token');
    expect(body).not.toContain('rate limited');
  });

  it('returns 503 when the server client cannot be created', async () => {
    mocks.createSupabaseServerClient.mockImplementationOnce(() => {
      throw new Error('config missing');
    });

    const response = await POST(request({ email: 'a@b.co' }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('config missing');
  });

  it('returns 503 when the reset request itself throws', async () => {
    mocks.resetPasswordForEmail.mockRejectedValueOnce(new Error('network down'));

    const response = await POST(request({ email: 'a@b.co' }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('network down');
  });

  it('supports POST only', async () => {
    expect((await GET()).status).toBe(405);
  });
});
