import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createCustomerServerClient: vi.fn(),
  settingsMaybeSingle: vi.fn(),
  edgeFetch: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: mocks.createCustomerServerClient,
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.settingsMaybeSingle })),
      })),
    })),
  },
}));

import { POST } from './route';

function request(body: unknown = { packageId: 'package-1' }) {
  return new NextRequest('https://example.test/api/account/wallet/topup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'rfz-customer-auth=synthetic-session' },
    body: JSON.stringify(body),
  });
}

function installActiveCustomer() {
  mocks.createCustomerServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'customer-a', email_confirmed_at: '2026-10-01T00:00:00Z' } },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'synthetic-customer-token' } } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'active' }, error: null }) })),
      })),
    })),
  });
}

describe('POST /api/account/wallet/topup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ketdhcmwowzztcdlmris.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    installActiveCustomer();
    mocks.settingsMaybeSingle.mockResolvedValue({
      data: { enabled: true, topups_enabled: true },
      error: null,
    });
    mocks.edgeFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocks.edgeFetch);
  });

  it.each([
    ['wallet disabled', { enabled: false, topups_enabled: false }],
    ['funding disabled', { enabled: true, topups_enabled: false }],
  ])('does not call the payment Edge Function when %s', async (_label, settings) => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: settings, error: null });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'RF Coins payments are unavailable.' });
    expect(mocks.edgeFetch).not.toHaveBeenCalled();
  });

  it('fails closed when the hosted wallet schema/settings are unavailable', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST205' } });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.edgeFetch).not.toHaveBeenCalled();
  });

  it('requires an active customer before reading wallet settings or contacting the provider path', async () => {
    mocks.createCustomerServerClient.mockResolvedValueOnce({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.settingsMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.edgeFetch).not.toHaveBeenCalled();
  });

  it('forwards only when the server-side wallet and top-up flags are explicitly enabled', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.edgeFetch).toHaveBeenCalledOnce();
    expect(String(mocks.edgeFetch.mock.calls[0][0])).toBe(
      'https://ketdhcmwowzztcdlmris.supabase.co/functions/v1/create-coin-topup-payment',
    );
  });
});
