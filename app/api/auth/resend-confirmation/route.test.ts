import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  resend: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createCustomerServerClient: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: mocks.createCustomerServerClient,
}));

vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: { rpc: mocks.rpc },
}));

import { GET, POST } from './route';
import { deriveCustomerConfirmationResendKey } from '@/lib/customerConfirmationResendKey';

const origin = 'https://example.test';
const GENERIC_OK = 'If the address can receive mail, confirmation instructions will be sent.';
const GENERIC_503 = 'Confirmation resend is temporarily unavailable.';

function request(body: unknown, includeOrigin = true, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/auth/resend-confirmation`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '192.0.2.10',
      ...(includeOrigin ? { origin } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function installAllowedReservation() {
  mocks.maybeSingle.mockResolvedValue({ data: { allowed: true, retry_after_seconds: 0 }, error: null });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
}

function installDeniedReservation(retryAfter = 42) {
  mocks.maybeSingle.mockResolvedValue({ data: { allowed: false, retry_after_seconds: retryAfter }, error: null });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
}

describe('POST /api/auth/resend-confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    process.env.RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET = 'test-secret-with-at-least-32-bytes-long!!';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    installAllowedReservation();
    mocks.resend.mockResolvedValue({ data: {}, error: null });
    mocks.createSupabaseServerClient.mockReturnValue({ auth: { resend: mocks.resend } });
  });

  it('accepts a valid trusted-origin request and returns the generic 202', async () => {
    const response = await POST(request({ email: 'Customer@Example.COM' }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: GENERIC_OK });
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'customer@example.com',
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
  });

  it('rejects untrusted origins with 403', async () => {
    const response = await POST(request({ email: 'customer@example.com' }, true, { origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('treats a missing Origin header as untrusted', async () => {
    const response = await POST(request({ email: 'customer@example.com' }, false));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('trims and normalizes the email before any downstream use', async () => {
    await POST(request({ email: '  Customer@Example.COM  ' }));

    expect(mocks.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'customer@example.com' }),
    );
  });

  it.each([
    { email: 'not-an-email' },
    { email: '' },
    { email: 42 },
    { email: null },
    { email: `${'a'.repeat(311)}@example.com` },
    {},
    null,
  ])('rejects invalid or non-string email with 400', async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await POST(request('not json'));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the HMAC secret is unavailable', async () => {
    delete process.env.RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET;
    installAllowedReservation();

    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: GENERIC_503 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('returns a generic 503 when the rate-limit RPC fails', async () => {
    installAllowedReservation();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'provider detail: connection refused' } });

    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toEqual(JSON.stringify({ error: GENERIC_503 }));
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(body).not.toContain('provider detail');
  });

  it('returns 429 with the retry hint when the rate limiter denies the request', async () => {
    installDeniedReservation(42);

    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Too many requests. Please try again later.',
      retry_after_seconds: 42,
    });
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('calls the exact rate-limit RPC name', async () => {
    await POST(request({ email: 'customer@example.com' }));

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0][0]).toBe('reserve_customer_confirmation_resend');
  });

  it('passes only hashed 64-hex keys to the RPC, never raw identifiers', async () => {
    await POST(request({ email: 'Customer@Example.COM' }));

    const args = mocks.rpc.mock.calls[0][1] as Record<string, string>;
    expect(Object.keys(args).sort()).toEqual(['p_email_key', 'p_network_key']);
    expect(args.p_email_key).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_network_key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain('Customer@Example.COM');
    expect(JSON.stringify(args)).not.toContain('192.0.2.10');
    expect(args.p_email_key).toBe(deriveCustomerConfirmationResendKey('email', 'customer@example.com'));
  });

  it('never echoes Auth resend errors or provider details', async () => {
    mocks.resend.mockResolvedValue({ data: null, error: { message: 'provider detail: rate limited upstream', code: 'over_email_send_rate_limit' } });

    const response = await POST(request({ email: 'customer@example.com' }));

    const body = await response.text();
    expect(response.status).toBe(202);
    expect(body).toEqual(JSON.stringify({ message: GENERIC_OK }));
    expect(body).not.toContain('rate limited upstream');
    expect(body).not.toContain('over_email_send_rate_limit');
  });

  it('gives existing and nonexistent accounts the same generic response when allowed', async () => {
    mocks.resend.mockResolvedValue({ data: null, error: { message: 'user not found', code: 'user_not_found' } });
    const existingResponse = await POST(request({ email: 'existing@example.com' }));

    installAllowedReservation();
    mocks.resend.mockResolvedValue({ data: {}, error: null });
    const nonexistentResponse = await POST(request({ email: 'nonexistent@example.com' }));

    expect(existingResponse.status).toBe(202);
    expect(nonexistentResponse.status).toBe(202);
    expect(await existingResponse.text()).toBe(await nonexistentResponse.text());
  });

  it('supports GET only as 405', async () => {
    expect((await GET()).status).toBe(405);
  });

  it('performs no Auth resend call when origin validation fails', async () => {
    const response = await POST(request({ email: 'customer@example.com' }, true, { origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('performs no Auth resend call when rate limiting fails', async () => {
    installDeniedReservation(60);

    const response = await POST(request({ email: 'customer@example.com' }));

    expect(response.status).toBe(429);
    expect(mocks.resend).not.toHaveBeenCalled();
  });
});
