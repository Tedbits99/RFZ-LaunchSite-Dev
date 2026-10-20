import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  orderMaybeSingle: vi.fn(),
  timelineSelect: vi.fn(),
  timelineOrder: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: (table: string) => table === 'orders'
      ? { select: () => ({ eq: () => ({ maybeSingle: mocks.orderMaybeSingle }) }) }
      : { select: (columns: string) => {
        mocks.timelineSelect(columns);
        return { eq: () => ({ order: mocks.timelineOrder }) };
      } },
  },
}));
vi.mock('@/lib/orderCapability', () => ({ authorizeOrderRequest: mocks.authorize }));

import { GET, POST } from './route';

const orderRecord = {
  id: 'synthetic-order-id',
  reference: 'RF-ABC234',
  email: 'guest@example.invalid',
  status: 'WAITING_PAYMENT',
  total_cents: 100,
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  payment_method: 'gcash',
  customer_user_id: null,
  games: { name: 'Synthetic Game' },
  packages: { name: 'Synthetic Package' },
};

describe('/api/orders/lookup private guest access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderMaybeSingle.mockResolvedValue({ data: orderRecord, error: null });
    mocks.timelineOrder.mockResolvedValue({ data: [{
      id: 'timeline-1', status: 'WAITING_PAYMENT', note: 'Created', created_at: '2026-10-17T00:00:00Z',
    }], error: null });
    mocks.authorize.mockResolvedValue(false);
  });

  it('denies reference and email alone before reading timeline data', async () => {
    const req = new NextRequest('http://localhost/api/orders/lookup?ref=RF-ABC234&email=guest%40example.invalid');
    const response = await GET(req);
    expect(response.status).toBe(404);
    expect(mocks.authorize).toHaveBeenCalled();
    expect(mocks.timelineOrder).not.toHaveBeenCalled();
  });

  it('returns only a capability-authorized guest order and privacy-minimized timeline', async () => {
    mocks.authorize.mockResolvedValue(true);
    const req = new NextRequest('http://localhost/api/orders/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'RF-ABC234', email: 'guest@example.invalid' }),
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.order.customer_user_id).toBeUndefined();
    expect(data.timeline[0].actor_email).toBeUndefined();
    expect(mocks.timelineSelect).toHaveBeenCalledWith('id, status, note, created_at');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('supports reference-only lookup only when the HttpOnly capability authorizes it', async () => {
    mocks.authorize.mockResolvedValue(true);
    const req = new NextRequest('http://localhost/api/orders/lookup?ref=RF-ABC234');
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalled();
  });

  it('denies a matching capability if the supplied email does not match the order', async () => {
    mocks.authorize.mockResolvedValue(true);
    const req = new NextRequest('http://localhost/api/orders/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'RF-ABC234', email: 'attacker@example.invalid' }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
    expect(mocks.timelineOrder).not.toHaveBeenCalled();
  });
});
