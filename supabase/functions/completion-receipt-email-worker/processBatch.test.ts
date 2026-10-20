import { describe, it, expect, vi } from 'vitest';
import { processReceiptBatch } from './processBatch';
const snapshot = { reference: 'RF-TEST', total_cents: 100, payment_method: 'gcash', game_name: 'Game', package_name: 'Pack', quantity: 1, masked_player_identifier: '****1234', completed_at: '2026-10-20T00:00:00Z' };
const claim = { out_id: 'receipt-1', out_recipient_email: 'synthetic@example.test', out_receipt_snapshot: snapshot, out_lease_token: 'lease-1', out_lease_until: '2026-10-20T01:00:00Z' };
const now = () => Date.parse('2026-10-20T00:00:00Z');
describe('receipt batch with isolated transport', () => {
  it('renders authoritative data and acknowledges only after delivery', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [claim], error: null }).mockResolvedValueOnce({ data: true, error: null });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processReceiptBatch({ rpc }, { send }, 'https://shop.example', now)).toMatchObject({ sent: 1, unknown: 0 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ recipient: claim.out_recipient_email, subject: 'Top-Up Successful — RF-TEST' }), 'completion-receipt:receipt-1');
    expect(rpc.mock.calls[1]).toEqual(['ack_completion_receipt_sent', { p_id: 'receipt-1', p_lease_token: 'lease-1', p_provider_message_id: null }]);
  });
  it('keeps ambiguous delivery leased, without acknowledging or logging provider errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [claim], error: null });
    const send = vi.fn().mockRejectedValue(new Error('private provider payload'));
    expect(await processReceiptBatch({ rpc }, { send }, 'https://shop.example', now)).toMatchObject({ unknown: 1, sent: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('never sends an expired lease', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...claim, out_lease_until: 'invalid' }], error: null });
    const send = vi.fn();
    expect(await processReceiptBatch({ rpc }, { send }, 'https://shop.example', now)).toMatchObject({ rejected: 1 });
    expect(send).not.toHaveBeenCalled();
  });
  it('persists invalid snapshot failures using the existing retry RPC', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ ...claim, out_receipt_snapshot: {} }], error: null }).mockResolvedValueOnce({ data: [{ out_status: 'pending' }], error: null });
    const send = vi.fn();
    expect(await processReceiptBatch({ rpc }, { send }, 'https://shop.example', now)).toMatchObject({ retryScheduled: 1 });
    expect(send).not.toHaveBeenCalled();
  });
  it('reports retry scheduling and dead-letter transitions from durable failure state', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ ...claim, out_receipt_snapshot: {} }], error: null })
      .mockResolvedValueOnce({ data: [{ out_status: 'dead_letter' }], error: null });
    const result = await processReceiptBatch({ rpc }, { send: vi.fn() }, 'https://shop.example', now);
    expect(result).toMatchObject({ deadLetter: 1, retryScheduled: 0 });
    expect(rpc.mock.calls[1][0]).toBe('fail_completion_receipt_outbox');
  });
  it('reports failure-state RPC errors as unknown instead of claiming a retry', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ ...claim, out_receipt_snapshot: {} }], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('private database payload') });
    const result = await processReceiptBatch({ rpc }, { send: vi.fn() }, 'https://shop.example', now);
    expect(result).toMatchObject({ unknown: 1, retryScheduled: 0, deadLetter: 0 });
  });
  it('does not call a delivered message sent if acknowledgement fails', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [claim], error: null }).mockRejectedValueOnce(new Error('database unavailable'));
    expect(await processReceiptBatch({ rpc }, { send: vi.fn().mockResolvedValue(undefined) }, 'https://shop.example', now)).toMatchObject({ sent: 0, unknown: 1 });
  });

  it('counts provider rejection as a scheduled retry', async () => {
    const invalid = { ...claim, out_recipient_email: 'not-an-email' };
    const rpc = vi.fn().mockResolvedValueOnce({ data: [invalid], error: null })
      .mockResolvedValueOnce({ data: [{ out_status: 'pending' }], error: null });
    expect(await processReceiptBatch({ rpc }, { send: vi.fn() }, 'https://shop.example', now)).toMatchObject({ retryScheduled: 1 });
    expect(rpc.mock.calls[1]).toEqual(['fail_completion_receipt_outbox', { p_id: claim.out_id, p_lease_token: claim.out_lease_token, p_error: 'PROVIDER_REJECTED' }]);
  });

  it('counts the maximum-attempt result as dead-lettered', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ ...claim, out_receipt_snapshot: {} }], error: null })
      .mockResolvedValueOnce({ data: [{ out_status: 'dead_letter' }], error: null });
    expect(await processReceiptBatch({ rpc }, { send: vi.fn() }, 'https://shop.example', now)).toMatchObject({ deadLetter: 1 });
  });

  it('allows only one of two workers to process an atomic claim result', async () => {
    let available = true;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'ack_completion_receipt_sent') return { data: true, error: null };
      if (name !== 'claim_completion_receipt_outbox' || !available) return { data: [], error: null };
      available = false;
      return { data: [claim], error: null };
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const [first, second] = await Promise.all([
      processReceiptBatch({ rpc }, { send }, 'https://shop.example', now),
      processReceiptBatch({ rpc }, { send }, 'https://shop.example', now),
    ]);
    expect(first.sent + second.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

import { createCompletionReceiptWorkerHandler } from './handler';
describe('authenticated receipt execution', () => {
  const secret = 'synthetic-invocation-secret-000000000000';
  const config = { enabled: 'true', invocationSecret: secret, appOrigin: 'https://shop.example' };
  const request = (authorized = true) => new Request('https://worker.example', { method: 'POST', headers: authorized ? { authorization: `Bearer ${secret}` } : {} });
  it('rejects invocation before database access', async () => {
    const rpc = vi.fn();
    const handler = createCompletionReceiptWorkerHandler(config, { db: { rpc }, deliveryTransport: { send: vi.fn() } });
    expect((await handler(request(false))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns unknown when the database cannot report job state', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('private database detail'));
    const handler = createCompletionReceiptWorkerHandler(config, { db: { rpc }, deliveryTransport: { send: vi.fn() } });
    const res = await handler(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unknown', error: 'Receipt processing unavailable.' });
  });
  it('runs the injected batch and reports the actual queue result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const handler = createCompletionReceiptWorkerHandler(config, { db: { rpc }, deliveryTransport: { send: vi.fn() } });
    expect(await (await handler(request())).json()).toMatchObject({ status: 'ok', sent: 0 });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('reuses the delivery key after lease rotation and an acknowledgement failure', async () => {
    const delivered = new Set<string>();
    let deliveries = 0;
    const send = vi.fn(async (_message, key: string) => { if (!delivered.has(key)) { delivered.add(key); deliveries++; } });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [claim], error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: [{ ...claim, out_lease_token: 'new-lease' }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    expect(await processReceiptBatch({ rpc }, { send }, config.appOrigin, now)).toMatchObject({ unknown: 1 });
    expect(await processReceiptBatch({ rpc }, { send }, config.appOrigin, now)).toMatchObject({ sent: 1 });
    expect(deliveries).toBe(1);
    expect(rpc.mock.calls[3][1]).toMatchObject({ p_lease_token: 'new-lease' });
  });
});
