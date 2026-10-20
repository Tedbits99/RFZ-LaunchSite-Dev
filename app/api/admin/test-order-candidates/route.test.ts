import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/adminGuard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: mocks.query } }));

import { GET } from './route';

describe('test order candidate API authorization', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    ['anonymous visitor', { ok: false, response: new Response('Unauthorized', { status: 401 }) }],
    ['authenticated customer', { ok: false, response: new Response('Forbidden', { status: 403 }) }],
    ['inactive staff', { ok: false, response: new Response('Forbidden', { status: 403 }) }],
    ['unauthorized staff role', { ok: false, response: new Response('Forbidden', { status: 403 }) }],
  ])('does not query customer orders for %s', async (_actor, decision) => {
    mocks.requireAdmin.mockResolvedValue(decision);

    const response = await GET(new NextRequest('https://shop.example/api/admin/test-order-candidates'));

    expect(response.status).toBe(decision.response.status);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns bounded candidate data after administrator authorization', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'order-1' }], error: null });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ not: vi.fn(() => ({ order })) }));
    mocks.query.mockReturnValue({ select });
    mocks.requireAdmin.mockResolvedValue({ ok: true, session: { role: 'ADMIN' } });

    const response = await GET(new NextRequest('https://shop.example/api/admin/test-order-candidates?limit=1000'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: 'order-1' }] });
    expect(mocks.query).toHaveBeenCalledWith('orders');
    expect(limit).toHaveBeenCalledWith(10);
  });
});
