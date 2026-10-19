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

import { POST } from './route';

function makeRequestClient() {
  return { rpc: mocks.rpc } as unknown as ReturnType<typeof Object>;
}

describe('/api/admin/rf-coins authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('rejects admins without the SUPER_ADMIN role before touching the database', async () => {
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
        target_user_id: 'u1',
        direction: 'credit',
        amount_coins: 10,
        reason: 'goodwill gesture',
        category: 'promotion',
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
