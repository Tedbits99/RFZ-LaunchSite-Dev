import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));

vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('@/lib/authSessionClients', () => ({ createCustomerServerClient: vi.fn() }));

import { POST } from './route';

describe('RF Coins spending release gate', () => {
  it('denies the wallet checkout endpoint before auth, order creation, or database access', async () => {
    const response = await POST(new NextRequest('https://runfazone.test/api/orders/coin', {
      method: 'POST',
      headers: { cookie: 'rfz-customer-auth=synthetic-test-session', 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'synthetic', packageId: 'synthetic', playerInputs: {} }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'RF Coins spending is not available in this release.' });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
