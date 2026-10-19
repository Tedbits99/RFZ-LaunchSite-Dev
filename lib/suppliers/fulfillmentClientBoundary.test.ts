import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAdapter } from './adapter';
import { pollFulfillmentStatus } from './fulfillment';

vi.mock('./adapter', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const fulfillmentSource = readFileSync(
  fileURLToPath(new URL('./fulfillment.ts', import.meta.url)),
  'utf8',
);

function makeDb() {
  const rpc = vi.fn(async () => ({
    data: [{ out_outcome: 'applied' }],
    error: null,
  }));
  const from = vi.fn((table: string) => {
    const data = table === 'supplier_transactions'
      ? { id: 'tx-1', supplier_id: 'supplier-1', supplier_reference: 'supplier-order-1', status: 'submitted' }
      : { code: 'fazercards', adapter: 'custom', enabled: true };
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data, error: null })),
    };
    return query;
  });
  return { from, rpc } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdapter).mockReturnValue({
    queryStatus: vi.fn(async () => ({ status: 'processing' })),
  } as any);
});

describe('supplier reconciliation client boundary', () => {
  it('passes a distinct server-created client to immediate polling', () => {
    expect(fulfillmentSource).toContain('pollImmediately(orderId, client, getDb())');
  });

  it('does not use the authenticated polling client for terminal reconciliation', () => {
    expect(fulfillmentSource).toContain('pollFulfillmentStatus(orderId, db, reconciliationDb)');
    expect(fulfillmentSource).toContain('const reconciliationClient = reconciliationDb || getDb();');
    expect(fulfillmentSource).not.toContain("client.rpc('finalize_supplier_reconciliation'");
  });

  it('uses only the privileged client for supplier COMPLETED reconciliation', async () => {
    const authenticatedDb = makeDb();
    const privilegedDb = makeDb();
    vi.mocked(getAdapter).mockReturnValue({
      queryStatus: vi.fn(async () => ({ status: 'completed' })),
    } as any);

    const result = await pollFulfillmentStatus('order-1', authenticatedDb, privilegedDb);

    expect(result).toEqual({ success: true, fulfillmentStatus: 'COMPLETED' });
    expect(authenticatedDb.rpc).not.toHaveBeenCalled();
    expect(privilegedDb.rpc).toHaveBeenCalledWith('finalize_supplier_reconciliation', expect.objectContaining({
      p_outcome: 'completed',
    }));
  });

  it('uses only the privileged client for supplier FAILED reconciliation', async () => {
    const authenticatedDb = makeDb();
    const privilegedDb = makeDb();
    vi.mocked(getAdapter).mockReturnValue({
      queryStatus: vi.fn(async () => ({ status: 'failed', error: 'synthetic supplier failure' })),
    } as any);

    const result = await pollFulfillmentStatus('order-1', authenticatedDb, privilegedDb);

    expect(result).toEqual({ success: true, fulfillmentStatus: 'FAILED' });
    expect(authenticatedDb.rpc).not.toHaveBeenCalled();
    expect(privilegedDb.rpc).toHaveBeenCalledWith('finalize_supplier_reconciliation', expect.objectContaining({
      p_outcome: 'failed',
    }));
  });

  it('leaves PROCESSING supplier results unfinalized', async () => {
    const authenticatedDb = makeDb();
    const privilegedDb = makeDb();

    const result = await pollFulfillmentStatus('order-1', authenticatedDb, privilegedDb);

    expect(result).toEqual({ success: true, fulfillmentStatus: 'PROCESSING' });
    expect(authenticatedDb.rpc).not.toHaveBeenCalled();
    expect(privilegedDb.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the privileged reconciliation client is unavailable', () => {
    expect(fulfillmentSource).toContain("return { success: false, error: 'Privileged reconciliation is not configured.' }");
  });

  it('fails closed at terminal reconciliation when no privileged client is configured', async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousSupabaseUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const authenticatedDb = makeDb();
      vi.mocked(getAdapter).mockReturnValue({
        queryStatus: vi.fn(async () => ({ status: 'completed' })),
      } as any);

      const result = await pollFulfillmentStatus('order-1', authenticatedDb);

      expect(result).toEqual({ success: false, error: 'Privileged reconciliation is not configured.' });
      expect(authenticatedDb.rpc).not.toHaveBeenCalled();
    } finally {
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousSupabaseUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });

  it('keeps the admin-authenticated client available for non-terminal fulfillment work', () => {
    expect(fulfillmentSource).toContain("client.rpc('complete_fulfillment'");
    expect(fulfillmentSource).toContain('fulfillOrder(orderId, order.package_id, playerId, serverId, client');
  });
});
