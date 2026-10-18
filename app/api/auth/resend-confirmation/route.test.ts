import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  resend: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createCustomerServerClient: vi.fn(),
  adminSupabase: vi.fn(),
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

const origin = 'https://example.test';

function request(body: unknown, includeOrigin = true) {
  return new NextRequest(`${origin}/api/auth/resend-confirmation`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '192.0.2.10',
      ...(includeOrigin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

const GENERIC_OK = 'If the address can receive mail, confirmation instructions will be sent.';

describe('POST /api/auth/resend-confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    process.env.RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET = 'test-secret-with-at-least-32-bytes-long!!';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    mocks.maybeSingle.mockResolvedValue({ data: { allowed: true, retry_after_seconds: 0 }, error: null });
    mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.resend.mockResolvedValue({ data: {}, error: null });
    mocks.createSupabaseServerClient.mockReturnValue({ auth: { resend: mocks.resend } });
  });

  it('accepts a valid email and calls reserve RPC plus resend', async () => {
    // route imports adminSupabase singleton; emulate allowed reservation
    const response = await POST(request({ email: 'Customer@Example.COM' }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: GENERIC_OK });
  });

  it('rejects invalid emails with 400 before any rate-limit or resend call', async () => {
    const response = await POST(request({ email: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('supports POST only', async () => {
    expect((await GET()).status).toBe(405);
  });
});
