import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  customerGetUser: vi.fn(),
  profileMaybeSingle: vi.fn(),
  packageMaybeSingle: vi.fn(),
  paymentMaybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  // Guest requests run the RPC on the global anon client (anon JWT in the DB).
  supabase: { rpc: mocks.rpc },
  isDbConfigured: true,
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: (table: string) => table === 'packages'
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.packageMaybeSingle }) }) }) }
      : { select: () => ({ eq: () => ({ maybeSingle: mocks.paymentMaybeSingle }) }) },
  },
}));
vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: () => ({
    auth: { getUser: mocks.customerGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profileMaybeSingle }) }) }),
    rpc: mocks.rpc,
  }),
}));
vi.mock('@/lib/voucher', () => ({ validateVoucher: vi.fn() }));
vi.mock('@/lib/paymentMethods', () => ({ paymentMethodLabel: () => 'Manual payment' }));

import { POST } from './route';

const body = {
  gameId: 'game-1',
  packageId: 'package-1',
  email: 'buyer@example.invalid',
  name: 'Buyer',
  playerInputs: { player_id: 'synthetic', __rfz_order_access_hash: 'client-forgery' },
  paymentMethod: 'gcash',
};

function request(payload = body, cookie?: string) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/orders authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.packageMaybeSingle.mockResolvedValue({
      data: {
        id: 'package-1', game_id: 'game-1', price_cents: 100,
        is_active: true, supplier_offer_id: null, supplier_category_id: null,
        games: { slug: 'test-game' },
      },
      error: null,
    });
    mocks.paymentMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('rejects direct RF Coins checkout requests before database or provider work while release-locked', async () => {
    const response = await POST(request({ ...body, paymentMethod: 'rf_coin_wallet' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'RF Coins spending is not available in this release.' });
    expect(mocks.packageMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not fall back to guest checkout when a recognized session is invalid', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid session') });
    const response = await POST(request(body, 'rfz-customer-auth=invalid'));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects unverified and inactive authenticated customers before order creation', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: {
      id: 'user-1', email: 'buyer@example.invalid', email_confirmed_at: null,
    } }, error: null });
    const unverified = await POST(request(body, 'rfz-customer-auth=valid'));
    expect(unverified.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.customerGetUser.mockResolvedValue({ data: { user: {
      id: 'user-1', email: 'buyer@example.invalid', email_confirmed_at: '2026-10-17T00:00:00Z',
    } }, error: null });
    mocks.profileMaybeSingle.mockResolvedValue({ data: { status: 'suspended' }, error: null });
    const suspended = await POST(request(body, 'rfz-customer-auth=valid'));
    expect(suspended.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('surfaces the database guest-checkout denial and replaces client capability input', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'GUEST_CHECKOUT_DISABLED' } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    const [, args] = mocks.rpc.mock.calls[0];
    expect(args.p_player_inputs.player_id).toBe('synthetic');
    expect(args.p_player_inputs.__rfz_order_access_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_player_inputs.__rfz_order_access_hash).not.toBe('client-forgery');
  });

  it('uses verified Auth email and the customer-JWT client for an active customer instead of the submitted email', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: {
      id: 'user-1', email: 'verified@example.invalid', email_confirmed_at: '2026-10-17T00:00:00Z',
    } }, error: null });
    mocks.profileMaybeSingle.mockResolvedValue({ data: { status: 'active' }, error: null });
    mocks.rpc.mockResolvedValue({ data: [{
      out_reference: 'RF-ABC234', out_order_id: 'order-1', out_total_cents: 100, out_error: null,
    }], error: null });
    const response = await POST(request({ ...body, email: 'attacker@example.invalid' }, 'rfz-customer-auth=valid'));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_email).toBe('verified@example.invalid');
    expect(mocks.rpc.mock.calls[0][1].p_voucher_email).toBe('verified@example.invalid');
    // create_order runs on the customer-namespace client so the database
    // ownership trigger sees the authenticated JWT's auth.uid().
    expect(mocks.rpc.mock.instances[0]).toBeDefined();
  });

  it('rejects a customer session thrown client exception without guest fallback', async () => {
    mocks.customerGetUser.mockRejectedValue(new Error('network'));
    const response = await POST(request(body, 'rfz-customer-auth=valid'));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('retains guest checkout when the database accepts the order and sets an HttpOnly capability cookie', async () => {
    mocks.rpc.mockResolvedValue({ data: [{
      out_reference: 'RF-ABC234', out_order_id: 'order-1', out_total_cents: 100, out_error: null,
    }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('rfz-order-rf-abc234=');
  });
});
