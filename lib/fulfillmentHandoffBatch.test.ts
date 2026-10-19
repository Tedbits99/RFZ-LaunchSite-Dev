import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  isAuthorizedFulfillmentHandoffRequest,
  getFulfillmentHandoffSecret,
  processFulfillmentHandoffBatch,
  runFulfillmentForOrder,
  fazercardsCreateOrder,
  CLAIM_BATCH_LIMIT,
  LEASE_SECONDS,
  HandoffRow,
} from './fulfillmentHandoffBatch';
import { hasValidReconciliationSecret } from './reconciliationSecurity';

const HANDOFF = 'handoff-secret-aaaaaaaaaaaaaaaa';
const RECON = 'recon-secret-aaaaaaaaaaaaaaaaa';

function okSupplierResponse() {
  return new Response(
    JSON.stringify({ ok: true, order: { id: 'FZ-REF-1' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return db as unknown as SupabaseClient & Record<string, ReturnType<typeof vi.fn>>;
}

const handoffRow: HandoffRow = {
  out_id: '11111111-1111-1111-1111-111111111111',
  out_order_id: '22222222-2222-2222-2222-222222222222',
  out_attempt_count: 1,
  out_lease_token: '33333333-3333-3333-3333-333333333333',
  out_lease_until: new Date(Date.now() + 300_000).toISOString(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPPLIER_FAZERCARDS_API_KEY;
});

describe('dispatch authentication (constant-time comparator reuse)', () => {
  it('accepts only the exact configured handoff secret', () => {
    expect(isAuthorizedFulfillmentHandoffRequest(HANDOFF, HANDOFF)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['wrong value', 'handoff-secret-bbbbbbbbbbbbbbbb'],
    ['prefix', HANDOFF.slice(0, -1)],
    ['extension', HANDOFF + 'x'],
    ['auto-recon secret instead', RECON],
  ] as [string, string | null][])('rejects %s', (_label, provided) => {
    expect(isAuthorizedFulfillmentHandoffRequest(provided, HANDOFF)).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    expect(isAuthorizedFulfillmentHandoffRequest(HANDOFF, null)).toBe(false);
    expect(isAuthorizedFulfillmentHandoffRequest(HANDOFF, undefined)).toBe(false);
  });

  it('delegates to the shared constant-time comparator (no parallel implementation)', () => {
    expect(isAuthorizedFulfillmentHandoffRequest(HANDOFF, HANDOFF))
      .toBe(hasValidReconciliationSecret(HANDOFF, HANDOFF));
  });

  it('reads the dedicated fulfillment_handoff_secret key from _cron_secrets', async () => {
    const db = makeDb({
      maybeSingle: vi.fn().mockResolvedValue({ data: { value: HANDOFF }, error: null }),
    });
    await expect(getFulfillmentHandoffSecret(db)).resolves.toBe(HANDOFF);
    expect(db.eq).toHaveBeenCalledWith('key', 'fulfillment_handoff_secret');
  });

  it('returns null (fail closed) when the secret row is missing or unreadable', async () => {
    const missing = makeDb({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) });
    await expect(getFulfillmentHandoffSecret(missing)).resolves.toBeNull();
    const errored = makeDb({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) });
    await expect(getFulfillmentHandoffSecret(errored)).resolves.toBeNull();
    const empty = makeDb({ maybeSingle: vi.fn().mockResolvedValue({ data: { value: '' }, error: null }) });
    await expect(getFulfillmentHandoffSecret(empty)).resolves.toBeNull();
  });
});

describe('batch execution (mocked database, mocked supplier fetch)', () => {
  function claimedDb(order: Record<string, unknown> | null, claimError = null) {
    const mapping = {
      id: 'map-1',
      enabled: true,
      supplier_product_id: 'prod-1',
      metadata: { category_id: 'cat-1', offer_id: 'offer-1' },
      suppliers: { id: 'sup-1', enabled: true, code: 'fazercards', adapter: 'custom' },
    };
    const db = makeDb({
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: order, error: null }) // order
        .mockResolvedValueOnce({ data: mapping, error: null }) // captured mapping
        .mockResolvedValueOnce({ data: null, error: null }), // existing tx check
      single: vi.fn().mockResolvedValue({ data: { id: 'tx-1' }, error: null }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') {
          return Promise.resolve({ data: [handoffRow], error: null });
        }
        if (fn === 'complete_fulfillment') {
          return Promise.resolve({ data: [{ out_transitioned: true }], error: claimError });
        }
        // rf_coin_ack_fulfillment_handoff
        return Promise.resolve({ data: [{ out_status: 'DONE' }], error: null });
      }),
    });
    return db;
  }

  const verifiedOrder = {
    id: handoffRow.out_order_id,
    payment_status: 'VERIFIED',
    fulfillment_status: 'PENDING',
    package_id: 'pkg-1',
    player_inputs: { user_id: '12345', server_id: '2222' },
    supplier_mapping_id: 'map-1',
  };

  function okSupplierResponse() {
    return new Response(
      JSON.stringify({ ok: true, order: { id: 'FZ-REF-1' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('claims exactly one row per invocation with a 300s lease', async () => {
    const db = makeDb({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const result = await processFulfillmentHandoffBatch(db);
    expect(result).toEqual({ claimed: 0, fulfilled: 0, failed: 0, rejected: 0 });
    expect(db.rpc).toHaveBeenCalledWith('rf_coin_claim_fulfillment_handoffs', {
      p_limit: CLAIM_BATCH_LIMIT,
      p_lease_seconds: LEASE_SECONDS,
    });
    expect(CLAIM_BATCH_LIMIT).toBe(1);
    expect(LEASE_SECONDS).toBe(300);
  });

  it('fulfills a verified order end-to-end and acks the lease as done', async () => {
    const db = claimedDb(verifiedOrder);
    process.env.SUPPLIER_FAZERCARDS_API_KEY = 'key-123';
    const fetchImpl = vi.fn().mockResolvedValue(okSupplierResponse());

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ claimed: 1, fulfilled: 1, failed: 0, rejected: 0 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.fzr.cards/api/v2/topups/order');
    expect((init.headers as Record<string, string>)['Idempotency-Key'])
      .toBe(`order_${handoffRow.out_order_id}_supplier_sup-1_retry_1`);
    expect(JSON.parse(String(init.body))).toEqual({
      category_id: 'cat-1',
      offer_id: 'offer-1',
      fields: { player_id: '12345', server_id: '2222' },
    });
    expect(db.rpc).toHaveBeenCalledWith('rf_coin_ack_fulfillment_handoff', {
      p_id: handoffRow.out_id,
      p_lease_token: handoffRow.out_lease_token,
      p_error: null,
    });
  });

  it('never fulfills an unverified payment', async () => {
    const db = makeDb({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...verifiedOrder, payment_status: 'PENDING' },
        error: null,
      }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') return Promise.resolve({ data: [handoffRow], error: null });
        return Promise.resolve({ data: [{ out_status: 'PENDING' }], error: null });
      }),
    });
    const fetchImpl = vi.fn();

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.fulfilled).toBe(0);
    expect(result.failed).toBe(1);
    // Ack carries the rejection error, so the queue retries with backoff.
    expect(db.rpc).toHaveBeenCalledWith('rf_coin_ack_fulfillment_handoff', expect.objectContaining({
      p_error: 'Payment not verified — fulfillment not authorized',
    }));
  });

  it('refuses fulfillment when the order is already claimed by another execution', async () => {
    const db = makeDb({
      maybeSingle: vi.fn().mockResolvedValue({ data: verifiedOrder, error: null }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') return Promise.resolve({ data: [handoffRow], error: null });
        if (fn === 'complete_fulfillment') return Promise.resolve({ data: [{ out_transitioned: false }], error: null });
        return Promise.resolve({ data: [{ out_status: 'DONE' }], error: null });
      }),
    });
    const fetchImpl = vi.fn();

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 1, fulfilled: 1, failed: 0, rejected: 0 });
  });

  it('never duplicates a supplier order when an active transaction already exists', async () => {
    const mapping = {
      id: 'map-1',
      enabled: true,
      metadata: { category_id: 'cat-1', offer_id: 'offer-1' },
      suppliers: { id: 'sup-1', enabled: true },
    };
    const db = makeDb({
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: verifiedOrder, error: null })
        .mockResolvedValueOnce({ data: mapping, error: null })
        .mockResolvedValueOnce({ data: { id: 'tx-existing', status: 'submitted' }, error: null }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') return Promise.resolve({ data: [handoffRow], error: null });
        if (fn === 'complete_fulfillment') return Promise.resolve({ data: [{ out_transitioned: true }], error: null });
        return Promise.resolve({ data: [{ out_status: 'DONE' }], error: null });
      }),
    });
    const fetchImpl = vi.fn();

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.fulfilled).toBe(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('treats a concurrent transaction insert (unique violation) as already-claimed, no supplier call', async () => {
    const mapping = {
      id: 'map-1',
      enabled: true,
      metadata: { category_id: 'cat-1', offer_id: 'offer-1' },
      suppliers: { id: 'sup-1', enabled: true },
    };
    const db = makeDb({
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: verifiedOrder, error: null })
        .mockResolvedValueOnce({ data: mapping, error: null })
        .mockResolvedValueOnce({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') return Promise.resolve({ data: [handoffRow], error: null });
        if (fn === 'complete_fulfillment') return Promise.resolve({ data: [{ out_transitioned: true }], error: null });
        return Promise.resolve({ data: [{ out_status: 'DONE' }], error: null });
      }),
    });
    const fetchImpl = vi.fn();

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.fulfilled).toBe(1);
  });

  it('marks a definitive supplier failure FAILED and records it in the ack', async () => {
    const db = claimedDb(verifiedOrder);
    process.env.SUPPLIER_FAZERCARDS_API_KEY = 'key-123';
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'invalid player id' }),
      { status: 400 },
    ));

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ claimed: 1, fulfilled: 0, failed: 1, rejected: 0 });
    expect(db.rpc).toHaveBeenCalledWith('rf_coin_ack_fulfillment_handoff', expect.objectContaining({
      p_error: 'invalid player id',
    }));
    // The order is moved to FAILED via complete_fulfillment.
    expect(db.rpc).toHaveBeenCalledWith('complete_fulfillment', expect.objectContaining({
      p_fulfillment_status: 'FAILED',
    }));
  });

  it('keeps a supplier timeout pending (never FAILED) and acks with the timeout error for bounded retry', async () => {
    const db = claimedDb(verifiedOrder);
    process.env.SUPPLIER_FAZERCARDS_API_KEY = 'key-123';
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);

    // Transaction stays pending for reconciliation to resolve.
    expect(db.update).toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('complete_fulfillment', expect.not.objectContaining({
      p_fulfillment_status: 'FAILED',
    }));
    expect(result.failed).toBe(1);
    expect(db.rpc).toHaveBeenCalledWith('rf_coin_ack_fulfillment_handoff', expect.objectContaining({
      p_error: 'The operation was aborted',
    }));
  });

  it('counts rejected acks (expired lease) without crashing the batch', async () => {
    const db = makeDb({
      maybeSingle: vi.fn().mockResolvedValue({ data: verifiedOrder, error: null }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'rf_coin_claim_fulfillment_handoffs') return Promise.resolve({ data: [handoffRow], error: null });
        if (fn === 'complete_fulfillment') return Promise.resolve({ data: [{ out_transitioned: true }], error: null });
        return Promise.resolve({ data: [{ out_status: 'rejected' }], error: null });
      }),
    });
    const fetchImpl = vi.fn().mockResolvedValue(okSupplierResponse());

    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ claimed: 1, fulfilled: 0, failed: 0, rejected: 1 });
  });

  it('throws a claim failure so the route returns 500 (lease protects against double-processing)', async () => {
    const db = makeDb({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }),
    });
    await expect(processFulfillmentHandoffBatch(db)).rejects.toThrow('Claim failed');
  });

  it('skips malformed claim rows without a supplier call', async () => {
    const db = makeDb({
      rpc: vi.fn().mockResolvedValue({
        data: [{ out_id: null, out_order_id: 'x', out_lease_token: null }],
        error: null,
      }),
    });
    const fetchImpl = vi.fn();
    const result = await processFulfillmentHandoffBatch(db, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ claimed: 1, fulfilled: 0, failed: 0, rejected: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('FazerCards-only supplier client', () => {
  it('always posts to the FazerCards v2 topup endpoint with API key and idempotency headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okSupplierResponse());
    await fazercardsCreateOrder('key', 'cat', 'offer', { player_id: '1' }, 'idem-key', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.fzr.cards/api/v2/topups/order');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('key');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key');
  });

  it('aborts the supplier request after the 30s timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      }),
    );
    const promise = fazercardsCreateOrder('key', 'cat', 'offer', {}, 'idem', fetchImpl as unknown as typeof fetch);
    vi.advanceTimersByTime(30_001);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
    vi.useRealTimers();
  });
});

describe('regression: existing safety helpers untouched', () => {
  it('normal reconciliation comparator still behaves identically', () => {
    expect(hasValidReconciliationSecret(RECON, RECON)).toBe(true);
    expect(hasValidReconciliationSecret(HANDOFF, RECON)).toBe(false);
  });
});
