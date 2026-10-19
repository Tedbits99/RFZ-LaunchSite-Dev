import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/adminGuard', () => ({
  requireAdmin: mocks.requireAdmin,
}));

// The refund route runs service-role-only RPCs (rf_coin_release_order_payment
// is granted to service_role exclusively), so the adminSupabase client is the
// correct db here; supabase must never be used for mutations.
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    __serviceRoleClient: true,
    from: (...args: unknown[]) => mocks.from(...(args as [])),
    rpc: (...args: unknown[]) => mocks.rpc(...(args as [])),
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { __anonClient: true } }));

import { POST } from './route';

const routeContext = { params: { id: '11111111-1111-1111-1111-111111111111' } };

type TableConfig = {
  maybeSingle?: unknown;
  insertError?: { message: string } | null;
  single?: unknown;
};

function makeDb(tableConfigs: Record<string, TableConfig>) {
  const callLog = { tables: [] as string[] };
  mocks.from.mockImplementation((table: string) => {
    callLog.tables.push(table);
    const cfg = tableConfigs[table] || {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.order = chain;
    builder.limit = chain;
    builder.maybeSingle = () => Promise.resolve({ data: cfg.maybeSingle ?? null, error: null });
    builder.insert = () => Promise.resolve({ data: null, error: cfg.insertError ?? null });
    return builder;
  });
  return callLog;
}

const superAdminSession = {
  ok: true,
  session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
  client: {},
};

function makeRequest(orderId: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'customer request' }),
  });
}

const coinOrder = {
  id: '11111111-1111-1111-1111-111111111111',
  reference: 'RFZ-1001',
  status: 'PAYMENT_VERIFIED',
  total_cents: 50000,
  payment_method: 'rf_coin_wallet',
  fulfillment_status: 'NOT_STARTED',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(superAdminSession);
  mocks.rpc.mockResolvedValue({
    data: [{ out_released: true, out_error: null }],
    error: null,
  });
});

describe('admin refund RF Coins integration', () => {
  it('refunds an eligible coin-paid order via the release RPC and records a REFUNDED refund', async () => {
    const log = makeDb({
      orders: { maybeSingle: coinOrder },
      refunds: { maybeSingle: null, insertError: null },
      order_timeline: { insertError: null },
    });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('REFUNDED');
    expect(mocks.rpc).toHaveBeenCalledWith('rf_coin_release_order_payment', {
      p_order_id: coinOrder.id,
      p_reason: expect.stringContaining('customer request'),
    });
    expect(log.tables).toContain('refunds');
    expect(log.tables).toContain('order_timeline');
  });

  it('is idempotent: a retried refund does not call insert again', async () => {
    let inserts = 0;
    makeDb({ orders: { maybeSingle: coinOrder } });
    mocks.from.mockImplementation((table: string) => {
      const cfg = table === 'refunds'
        ? { maybeSingle: { reference: 'RFD-EXISTING', status: 'REFUNDED' } }
        : table === 'orders'
          ? { maybeSingle: coinOrder }
          : {};
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.maybeSingle = () =>
        Promise.resolve({ data: (cfg as { maybeSingle?: unknown }).maybeSingle ?? null, error: null });
      builder.insert = () => {
        inserts += 1;
        return Promise.resolve({ data: null, error: null });
      };
      return builder;
    });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reference).toBe('RFD-EXISTING');
    expect(inserts).toBe(0);
  });

  it('rejects a coin refund when the release RPC fails and records nothing', async () => {
    const log = makeDb({
      orders: { maybeSingle: coinOrder },
      refunds: {},
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(500);
    expect(log.tables).not.toContain('refunds');
    expect(log.tables).not.toContain('order_timeline');
  });

  it('surfaces RPC-level ineligibility (e.g. no wallet payment) as a 400', async () => {
    makeDb({ orders: { maybeSingle: coinOrder }, refunds: {} });
    mocks.rpc.mockResolvedValue({
      data: [{ out_released: false, out_error: 'RF_COIN_NO_ORDER_PAYMENT' }],
      error: null,
    });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('wallet');
  });

  it('rejects an already supplier-fulfilled coin order before calling the RPC', async () => {
    makeDb({ orders: { maybeSingle: { ...coinOrder, fulfillment_status: 'PROCESSING' } } });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a coin order already moved to REFUND_PENDING without calling the RPC', async () => {
    makeDb({ orders: { maybeSingle: { ...coinOrder, status: 'REFUND_PENDING' } } });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('leaves the non-coin PayMongo refund flow unchanged', async () => {
    makeDb({
      orders: {
        maybeSingle: { ...coinOrder, payment_method: 'paymongo_qrph', status: 'PAID', fulfillment_status: 'NOT_STARTED' },
      },
      refunds: {},
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('REFUND_PENDING');
    // Only admin_change_order_status may run for non-coin orders.
    expect(mocks.rpc).toHaveBeenCalledWith('admin_change_order_status', expect.any(Object));
    expect(mocks.rpc).not.toHaveBeenCalledWith('rf_coin_release_order_payment', expect.anything());
  });

  it('rejects unauthenticated callers before any database access', async () => {
    makeDb({});
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response('denied', { status: 401 }) });
    const res = await POST(makeRequest(coinOrder.id), routeContext);
    expect(res.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a refund reason', async () => {
    makeDb({});
    const req = new NextRequest(`http://localhost/api/admin/orders/${coinOrder.id}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '  ' }),
    });
    const res = await POST(req, routeContext);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
