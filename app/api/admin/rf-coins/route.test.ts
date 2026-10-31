import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/adminGuard', () => ({
  requireAdmin: mocks.requireAdmin,
}));

// Any direct use of the service-role client for mutations must not happen:
// the route must run RPCs on requireAdmin's request-scoped client.
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: { __serviceRoleClient: true },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { __anonClient: true } }));

import { GET, POST } from './route';

function makeRequestClient() {
  return { rpc: mocks.rpc } as unknown as ReturnType<typeof Object>;
}

describe('/api/admin/rf-coins authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('rejects admins without the SUPER_ADMIN role before touching reporting RPCs', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'admin@example.invalid', name: 'A', role: 'ADMIN' },
      client: makeRequestClient(),
    });
    const req = new NextRequest('http://localhost/api/admin/rf-coins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'settings', enabled: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('denies generic admins from the financial read endpoint before touching the database', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'admin@example.invalid', name: 'A', role: 'ADMIN' },
      client: makeRequestClient(),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins'));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('uses the caller JWT reporting RPC and masks database switches behind release locks', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    mocks.rpc.mockResolvedValue({ data: {
      settings: { enabled: true, topups_enabled: true, spending_enabled: true },
      metrics: { outstanding: '25' }, wallets: { rows: [], total: 0 }, topups: { rows: [], total: 0 },
      ledger: { rows: [], total: 0 }, adjustmentRequests: { rows: [], total: 0 },
      packages: { rows: [], total: 0 }, audit: { rows: [], total: 0 }, trend: [], range: {},
    }, error: null });

    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins?page=1'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('rf_coin_admin_center_read', expect.objectContaining({ p_page_size: 25 }));
    expect(json.settings.topups_enabled).toBe(false);
    expect(json.settings.spending_enabled).toBe(false);
    expect(json.settings.database_topups_enabled).toBe(true);
    expect(json.release).toEqual({ fundingEnabled: false, spendingEnabled: false });
  });

  it('reports staged/missing wallet schema explicitly instead of zero balances', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins'));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error).toBe('RF Coins has not been configured for this environment.');
    expect(json.metrics).toBeUndefined();
  });

  it('creates a bounded, audited CSV export and neutralizes spreadsheet formulas', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    mocks.rpc
      .mockResolvedValueOnce({ data: {
        wallets: { total: '1', rows: [{ user_id: '=HYPERLINK("x")', balance_coins: '0', total_purchased_coins: '0', total_spent_coins: '0', total_manual_credited_coins: '0', total_manual_debited_coins: '0', total_reversed_coins: '0', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }] },
      }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins?export=wallets&from=2026-10-01T00%3A00%3A00Z&to=2026-10-02T00%3A00%3A00Z'));
    const csv = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('rf-coins-wallets-');
    expect(res.headers.get('x-exported-rows')).toBe('1');
    expect(csv).toContain("'=HYPERLINK(\"\"x\"\")");
    expect(csv).not.toContain('super@example.invalid');
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'rf_coin_record_admin_export', expect.objectContaining({ p_export_type: 'wallets', p_row_count: 1 }));
  });

  it('refuses exports larger than 1,000 rows and does not write an audit event', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    mocks.rpc.mockResolvedValueOnce({ data: { wallets: { total: '1001', rows: [] } }, error: null });
    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins?export=wallets'));
    expect(res.status).toBe(413);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects export attempts before reporting for an ordinary admin', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a2', email: 'admin@example.invalid', name: 'A', role: 'ADMIN' },
      client: makeRequestClient(),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/rf-coins?export=audit'));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid server-side wallet and top-up filters', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    const wallet = await GET(new NextRequest('http://localhost/api/admin/rf-coins?wallet_status=all-users'));
    const topup = await GET(new NextRequest('http://localhost/api/admin/rf-coins?topup_status=SETTLED'));
    const provider = await GET(new NextRequest('http://localhost/api/admin/rf-coins?provider=bad%20provider'));
    expect(wallet.status).toBe(400);
    expect(topup.status).toBe(400);
    expect(provider.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses attempts to enable financial feature switches from the admin API', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    const req = new NextRequest('http://localhost/api/admin/rf-coins', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'settings', topups_enabled: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(423);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response('denied', { status: 401 }) });
    const req = new NextRequest('http://localhost/api/admin/rf-coins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'adjustment' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('runs mutation RPCs on the request-scoped admin client, not the service-role client', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    const req = new NextRequest('http://localhost/api/admin/rf-coins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'adjustment',
        target_user_id: '11111111-1111-4111-8111-111111111111',
        direction: 'credit',
        amount_coins: 10,
        reason: 'goodwill gesture',
        category: 'promotion',
        idempotency_key: 'route-test-adjustment-key-0001',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.instances[0]).toBeDefined();
    // The RPC was invoked on the request client's rpc method (the mocked one),
    // proving mutations do not run on the service-role singleton.
    expect(mocks.rpc).toHaveBeenCalledWith('rf_coin_request_adjustment', expect.any(Object));
  });

  it('rejects an unknown action without executing any RPC', async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      session: { userId: 'a1', email: 'super@example.invalid', name: 'S', role: 'SUPER_ADMIN' },
      client: makeRequestClient(),
    });
    const req = new NextRequest('http://localhost/api/admin/rf-coins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'drop_ledger' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
