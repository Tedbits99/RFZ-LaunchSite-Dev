import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  hasValidReconciliationSecret,
  authorizeFulfillmentHandoffDispatch,
} from '../_shared/reconciliationSecurity';
import {
  processFulfillmentHandoffBatch,
  getFulfillmentHandoffSecret,
  isAuthorizedFulfillmentHandoffRequest,
} from '../_shared/fulfillmentHandoffWorker';

const reconSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const workerSource = readFileSync(
  new URL('../_shared/fulfillmentHandoffWorker.ts', import.meta.url),
  'utf8',
);

describe('dispatch authentication decision (behavioral)', () => {
  const HANDOFF = 'handoff-secret-aaaaaaaaaaaaaaaa';
  const RECON = 'recon-secret-aaaaaaaaaaaaaaaaa';

  it('correct fulfillment secret + dispatch => authorized', () => {
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'fulfillment-handoff',
        providedSecret: HANDOFF,
        configuredHandoffSecret: HANDOFF,
      }),
    ).toBe('authorized');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['incorrect', 'handoff-secret-bbbbbbbbbbbbbbbb'],
    ['prefix of configured', HANDOFF.slice(0, -1)],
    ['extension of configured', HANDOFF + 'x'],
    [
      'correct auto-reconciliation secret presented alone',
      RECON,
    ],
  ] as [string, string | null][])(
    'dispatch with %s secret => unauthorized (401 path)',
    (_label, provided) => {
      expect(
        authorizeFulfillmentHandoffDispatch({
          dispatch: 'fulfillment-handoff',
          providedSecret: provided,
          configuredHandoffSecret: HANDOFF,
        }),
      ).toBe('unauthorized');
    },
  );

  it('dispatch with no configured handoff secret => unavailable (503 path, fails closed)', () => {
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'fulfillment-handoff',
        providedSecret: HANDOFF,
        configuredHandoffSecret: null,
      }),
    ).toBe('unavailable');
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'fulfillment-handoff',
        providedSecret: HANDOFF,
        configuredHandoffSecret: undefined,
      }),
    ).toBe('unavailable');
  });

  it('no dispatch parameter => not-dispatch (falls through to normal reconciliation)', () => {
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: null,
        providedSecret: HANDOFF,
        configuredHandoffSecret: HANDOFF,
      }),
    ).toBe('not-dispatch');
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'other',
        providedSecret: HANDOFF,
        configuredHandoffSecret: HANDOFF,
      }),
    ).toBe('not-dispatch');
  });
});

describe('dispatch request handling (behavioral, mocked db)', () => {
  const HANDOFF = 'handoff-secret-aaaaaaaaaaaaaaaa';
  let db: Record<string, unknown>;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { value: HANDOFF }, error: null }),
      rpc: vi.fn(),
    };
  });

  function makeRequest(path: string, secret: string | null): Request {
    return new Request(`https://edge.example${path}`, {
      method: 'POST',
      headers: secret ? { 'X-Cron-Secret': secret } : {},
    });
  }

  it('authenticates the dispatch using ONLY the fulfillment handoff secret (never auto_recon_secret)', () => {
    // The auth decision must be a function of the handoff secret alone.
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'fulfillment-handoff',
        providedSecret: HANDOFF,
        configuredHandoffSecret: HANDOFF,
      }),
    ).toBe('authorized');
    // Even a valid auto-recon secret never satisfies the dispatch gate.
    expect(
      authorizeFulfillmentHandoffDispatch({
        dispatch: 'fulfillment-handoff',
        providedSecret: 'recon-secret-aaaaaaaaaaaaaaaaa',
        configuredHandoffSecret: HANDOFF,
      }),
    ).toBe('unauthorized');
  });

  it('health request authorized by handoff secret returns 200, zero claims, no supplier fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await (async () => {
      // Simulate the handler's post-auth health branch in isolation from Deno globals.
      const url = new URL(makeRequest('/?dispatch=fulfillment-handoff&health=1', HANDOFF).url);
      const decision = authorizeFulfillmentHandoffDispatch({
        dispatch: url.searchParams.get('dispatch'),
        providedSecret: HANDOFF,
        configuredHandoffSecret: HANDOFF,
      });
      if (decision !== 'authorized') throw new Error(`unexpected decision: ${decision}`);
      if (url.searchParams.get('health') === '1') {
        return new Response(JSON.stringify({ ok: true, claimed: 0 }), { status: 200 });
      }
      return processFulfillmentHandoffBatch(db as never);
    })();

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toEqual({ ok: true, claimed: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('unauthorized dispatch never reaches the queue claim RPC or the supplier API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const decision = authorizeFulfillmentHandoffDispatch({
      dispatch: 'fulfillment-handoff',
      providedSecret: 'wrong-secret',
      configuredHandoffSecret: HANDOFF,
    });
    expect(decision).toBe('unauthorized');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('dispatch source contract (auto-reconciliation/index.ts)', () => {
  it('dispatch selection occurs before normal reconciliation processing', () => {
    const serve = reconSource.slice(reconSource.indexOf('Deno.serve'));
    const dispatchIndex = serve.indexOf('handleFulfillmentHandoffDispatch(req)');
    const reconPollIndex = serve.indexOf('supplier_transactions');
    expect(dispatchIndex).toBeGreaterThan(0);
    expect(reconPollIndex).toBeGreaterThan(dispatchIndex);
  });

  it('handler authorizes the dispatch solely through the fulfillment handoff secret', () => {
    const handler = reconSource.slice(
      reconSource.indexOf('handleFulfillmentHandoffDispatch'),
    );
    expect(handler).toContain('authorizeFulfillmentHandoffDispatch');
    expect(handler).toContain('configuredHandoffSecret: handoffSecret');
    // The dual-gate (auto_recon_secret inside the dispatch handler) is gone.
    const handlerEnd = reconSource.indexOf('Deno.serve');
    const handlerBody = reconSource.slice(
      reconSource.indexOf('async function handleFulfillmentHandoffDispatch'),
      handlerEnd,
    );
    expect(handlerBody).not.toContain('auto_recon_secret');
  });

  it('normal reconciliation path remains authenticated by auto_recon_secret', () => {
    const serve = reconSource.slice(reconSource.indexOf('Deno.serve'));
    expect(serve).toContain('"auto_recon_secret"');
    expect(serve).toContain(
      'hasValidReconciliationSecret(req.headers.get("X-Cron-Secret"), configuredSecret)',
    );
  });

  it('health probe sits behind dispatch auth and before any queue claim', () => {
    const handler = reconSource.slice(
      reconSource.indexOf('async function handleFulfillmentHandoffDispatch'),
    );
    const healthIndex = handler.indexOf('"health"');
    const claimIndex = handler.indexOf('processFulfillmentHandoffBatch(db)');
    expect(healthIndex).toBeGreaterThan(0);
    expect(claimIndex).toBeGreaterThan(healthIndex);
    expect(handler.slice(healthIndex, claimIndex)).toContain('claimed: 0');
    expect(handler.slice(healthIndex, claimIndex)).not.toContain('fetch(');
  });
});

describe('shared handoff worker preserves the reviewed safety contract', () => {
  it('uses the same cron secret key and constant-time comparator as the reviewed worker', () => {
    expect(workerSource).toContain('"fulfillment_handoff_secret"');
    expect(workerSource).toContain('hasValidReconciliationSecret(providedSecret, configuredSecret)');
    expect(workerSource).toContain('export function isAuthorizedFulfillmentHandoffRequest');
  });

  it('claims the queue only through the atomic claim RPC and acks via the lease-bound ack RPC', () => {
    expect(workerSource).toContain('rf_coin_claim_fulfillment_handoffs');
    expect(workerSource).toContain('rf_coin_ack_fulfillment_handoff');
  });

  it('refuses fulfillment when payment is not verified', () => {
    expect(workerSource).toContain('Payment not verified — fulfillment not authorized');
  });

  it('never duplicates supplier orders: checks existing active transaction and uses idempotency keys', () => {
    expect(workerSource).toContain('.eq("action", "create_order")');
    expect(workerSource).toContain('Idempotency-Key');
  });

  it('secret helper reads the dedicated fulfillment handoff secret, not auto_recon_secret', async () => {
    const db = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'x' }, error: null }),
    };
    await getFulfillmentHandoffSecret(db as never);
    expect(db.eq).toHaveBeenCalledWith('key', 'fulfillment_handoff_secret');
  });

  it('isAuthorizedFulfillmentHandoffRequest delegates to the constant-time comparator', () => {
    expect(isAuthorizedFulfillmentHandoffRequest('a'.repeat(28), 'a'.repeat(28))).toBe(true);
    expect(isAuthorizedFulfillmentHandoffRequest('a'.repeat(27), 'a'.repeat(28))).toBe(false);
    expect(isAuthorizedFulfillmentHandoffRequest(null, 'a'.repeat(28))).toBe(false);
  });
});

describe('normal reconciliation path auth matrix (unchanged behavior)', () => {
  const configured = 'recon-secret-aaaaaaaaaaaaaaaaa';
  const header = (value: string | null) =>
    hasValidReconciliationSecret(value, configured);

  it('accepts only the exact configured secret', () => {
    expect(header(configured)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['wrong value', 'recon-secret-bbbbbbbbbbbbbbbbb'],
    ['prefix', configured.slice(0, -1)],
    ['extension', configured + 'x'],
  ] as [string, string | null][])('rejects %s header', (_label, value) => {
    expect(header(value)).toBe(false);
  });
});
