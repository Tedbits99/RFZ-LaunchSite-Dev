import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  customerGetUser: vi.fn(),
  capabilityMaybeSingle: vi.fn(),
  adminMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: () => ({ auth: { getUser: mocks.customerGetUser } }),
}));
vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'guest_order_access'
          ? { eq: () => ({ is: () => ({ gt: () => ({ maybeSingle: mocks.capabilityMaybeSingle }) }) }) }
          : { eq: () => ({ maybeSingle: mocks.adminMaybeSingle }) },
      }),
    }),
  },
}));

import { authorizeOrderRequest, hashOrderCapability, orderCapabilityCookieName } from './orderCapability';

const order = { id: 'order-1', reference: 'RF-ABC234', customer_user_id: null };
const token = 'A'.repeat(43);

describe('private order capability authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.customerGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.capabilityMaybeSingle.mockResolvedValue({ data: { order_id: order.id }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('uses an HttpOnly-cookie-compatible per-order capability and hashes it before lookup', async () => {
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: `${orderCapabilityCookieName(order.reference)}=${token}` },
    });
    expect(await authorizeOrderRequest(req, order)).toBe(true);
    expect(mocks.capabilityMaybeSingle).toHaveBeenCalled();
    expect(hashOrderCapability(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not fall back to a guest capability when a recognized Auth session is invalid', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: `sb-project-auth-token=invalid; ${orderCapabilityCookieName(order.reference)}=${token}` },
    });
    expect(await authorizeOrderRequest(req, order)).toBe(false);
    expect(mocks.capabilityMaybeSingle).not.toHaveBeenCalled();
  });

  it('allows the matching authenticated order owner without exposing guest capabilities', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: 'sb-project-auth-token=valid' },
    });
    expect(await authorizeOrderRequest(req, { ...order, customer_user_id: 'owner-1' })).toBe(true);
    expect(mocks.capabilityMaybeSingle).not.toHaveBeenCalled();
  });

  it('rejects missing, expired, or mismatched capability records', async () => {
    mocks.capabilityMaybeSingle.mockResolvedValue({ data: null, error: null });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: `${orderCapabilityCookieName(order.reference)}=${token}` },
    });
    expect(await authorizeOrderRequest(req, order)).toBe(false);
    expect(await authorizeOrderRequest(new NextRequest('http://localhost/api/order'), order)).toBe(false);
  });

  it('recognizes the customer namespace session as the order owner', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: { id: 'customer-1' } }, error: null });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: 'rfz-customer-auth=valid' },
    });
    expect(await authorizeOrderRequest(req, { ...order, customer_user_id: 'customer-1' })).toBe(true);
    expect(mocks.capabilityMaybeSingle).not.toHaveBeenCalled();
  });

  it('never grants a customer session access to another customer’s order', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: { id: 'customer-1' } }, error: null });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: 'rfz-customer-auth=valid' },
    });
    expect(await authorizeOrderRequest(req, { ...order, customer_user_id: 'customer-2' })).toBe(false);
    expect(mocks.capabilityMaybeSingle).not.toHaveBeenCalled();
  });

  it('does not fall back to guest capability when a customer session is invalid', async () => {
    mocks.customerGetUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: `rfz-customer-auth=invalid; ${orderCapabilityCookieName(order.reference)}=${token}` },
    });
    expect(await authorizeOrderRequest(req, order)).toBe(false);
    expect(mocks.capabilityMaybeSingle).not.toHaveBeenCalled();
  });

  it('does not grant customer access merely because an email matches', async () => {
    mocks.customerGetUser.mockResolvedValue({
      data: { user: { id: 'customer-1', email: 'owner@example.invalid' } },
      error: null,
    });
    const req = new NextRequest('http://localhost/api/order', {
      headers: { cookie: 'rfz-customer-auth=valid' },
    });
    // Same email, different UUID owner: email matching grants nothing.
    expect(await authorizeOrderRequest(req, { ...order, customer_user_id: 'customer-2' })).toBe(false);
  });
});
