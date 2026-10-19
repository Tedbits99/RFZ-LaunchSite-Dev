import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasValidReconciliationSecret } from '../_shared/reconciliationSecurity';

const reconSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const workerSource = readFileSync(
  new URL('../_shared/fulfillmentHandoffWorker.ts', import.meta.url),
  'utf8',
);

describe('auto-reconciliation fulfillment-handoff dispatch contract', () => {
  it('serves the dispatch only behind the dispatch query parameter', () => {
    const dispatchIndex = reconSource.indexOf('"dispatch"');
    expect(dispatchIndex).toBeGreaterThan(0);
    expect(reconSource).toContain('"fulfillment-handoff"');
  });

  it('runs the dispatch check before any reconciliation work in the handler', () => {
    const serve = reconSource.slice(reconSource.indexOf('Deno.serve'));
    const dispatchIndex = serve.indexOf('handleFulfillmentHandoffDispatch(req)');
    const reconPollIndex = serve.indexOf('supplier_transactions');
    expect(dispatchIndex).toBeGreaterThan(0);
    expect(reconPollIndex).toBeGreaterThan(dispatchIndex);
  });

  it('requires both cron secrets before any queue claim', () => {
    const handler = reconSource.slice(
      reconSource.indexOf('handleFulfillmentHandoffDispatch'),
    );
    const reconSecretCheck = handler.indexOf('auto_recon_secret');
    const handoffSecretCheck = handler.indexOf('getFulfillmentHandoffSecret(db)');
    const claimCheck = handler.indexOf('processFulfillmentHandoffBatch(db)');
    const sharedClaimCheck = workerSource.indexOf('rf_coin_claim_fulfillment_handoffs');
    expect(reconSecretCheck).toBeGreaterThan(0);
    expect(handoffSecretCheck).toBeGreaterThan(reconSecretCheck);
    expect(claimCheck).toBeGreaterThan(handoffSecretCheck);
    expect(sharedClaimCheck).toBeGreaterThan(0);
  });

  it('health probe returns 200, zero claims, before the claim RPC and without supplier fetches', () => {
    const handler = reconSource.slice(
      reconSource.indexOf('handleFulfillmentHandoffDispatch'),
    );
    const healthIndex = handler.indexOf('"health"');
    const claimIndex = handler.indexOf('processFulfillmentHandoffBatch(db)');
    expect(healthIndex).toBeGreaterThan(0);
    expect(claimIndex).toBeGreaterThan(healthIndex);
    expect(handler.slice(healthIndex, claimIndex)).toContain('claimed: 0');
    expect(handler.slice(healthIndex, claimIndex)).not.toContain('fetch(');
  });

  it('unchanged default behavior: reconciliation path still gated by auto_recon_secret', () => {
    expect(reconSource).toContain('"auto_recon_secret"');
    expect(reconSource).toContain('hasValidReconciliationSecret(req.headers.get("X-Cron-Secret"), configuredSecret)');
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
});

describe('health-check authentication matrix (shared comparator)', () => {
  const configured = 'cron-secret-aaaaaaaaaaaaaaaaaaaa';
  const header = (value: string | null) =>
    hasValidReconciliationSecret(value, configured);

  it('accepts only the exact configured secret', () => {
    expect(header(configured)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['wrong value', 'cron-secret-bbbbbbbbbbbbbbbbbbbb'],
    ['prefix', configured.slice(0, -1)],
    ['extension', configured + 'x'],
  ] as [string, string | null][])('rejects %s header before any queue or supplier action', (_label, value) => {
    expect(header(value)).toBe(false);
  });
});
