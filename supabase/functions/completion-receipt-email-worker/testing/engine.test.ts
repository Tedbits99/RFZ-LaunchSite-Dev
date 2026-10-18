import { describe, expect, it, vi } from 'vitest';
import {
  FakeTransportFailure,
  runCompletionReceiptWorkerEngine,
  type ClaimedCompletionReceipt,
  type CompletionReceiptWorkerDiagnostic,
  type CompletionReceiptWorkerEngineDependencies,
  type CompletionReceiptWorkerRpc,
} from './engine.ts';
import type { CompletionReceiptMessage, CompletionReceiptTransport } from '../transportContract.ts';

const APP_ORIGIN = 'https://runfazone.example';
const SNAPSHOT = {
  reference: 'RF-TEST-123',
  total_cents: 1299,
  payment_method: 'gcash',
  game_name: 'Test Game',
  package_name: 'Test Package',
  quantity: 2,
  masked_player_identifier: '******7890',
  completed_at: '2026-10-18T12:00:00+00:00',
};

function row(overrides: Partial<ClaimedCompletionReceipt> = {}): ClaimedCompletionReceipt {
  return {
    out_id: '10000000-0000-4000-8000-000000000001',
    out_order_id: '10000000-0000-4000-8000-000000000002',
    out_recipient_email: 'test-recipient@example.invalid',
    out_receipt_snapshot: SNAPSHOT,
    out_attempt_count: 1,
    out_lease_token: '10000000-0000-4000-8000-000000000003',
    out_lease_until: '2026-10-18T12:05:00Z',
    ...overrides,
  };
}

function setup(rows: ClaimedCompletionReceipt[] = [row()], send: (message: CompletionReceiptMessage) => Promise<void> = async () => {}) {
  const events: string[] = [];
  const rpc: CompletionReceiptWorkerRpc = {
    claim: vi.fn(async (limit, leaseSeconds) => {
      events.push(`claim:${limit}:${leaseSeconds}`);
      return rows;
    }),
    acknowledge: vi.fn(async (id, token, providerId) => {
      events.push(`ack:${id}:${token}:${providerId ?? ''}`);
      return true;
    }),
    fail: vi.fn(async (id, token, category) => {
      events.push(`fail:${id}:${token}:${category}`);
      return { out_status: 'pending', out_next_attempt_at: '2026-10-18T12:01:00Z' };
    }),
  };
  const transport: CompletionReceiptTransport = {
    send: vi.fn(async (message) => {
      events.push(`send:${message.recipient}`);
      await send(message);
    }),
  };
  return { dependencies: { rpc, transport } satisfies CompletionReceiptWorkerEngineDependencies, rpc, transport, events };
}

describe('isolated completion receipt worker engine', () => {
  it('claims, renders, fake-delivers, then acknowledges once with the claimed lease token', async () => {
    const setupResult = setup();
    const sent: CompletionReceiptMessage[] = [];
    vi.mocked(setupResult.transport.send).mockImplementation(async (message) => {
      sent.push(message);
      setupResult.events.push(`send:${message.recipient}`);
    });

    const result = await runCompletionReceiptWorkerEngine(setupResult.dependencies, APP_ORIGIN);

    expect(setupResult.events).toEqual([
      'claim:5:300',
      'send:test-recipient@example.invalid',
      'ack:10000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000003:',
    ]);
    expect(setupResult.rpc.acknowledge).toHaveBeenCalledTimes(1);
    expect(setupResult.rpc.acknowledge).toHaveBeenCalledWith(row().out_id, row().out_lease_token, null);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('RF-TEST-123');
    expect(sent[0].html).toContain('******7890');
    expect(sent[0].html).not.toContain('1234567890');
    expect(sent[0].text).toContain('https://runfazone.example/track-order?ref=RF-TEST-123');
    expect(result).toEqual({ claimed: 1, fakeDeliveries: 1, acknowledged: 1, retryScheduled: 0, deadLettered: 0, lostLeases: 0, errors: 0 });
  });

  it('does not call a transport for an empty batch', async () => {
    const value = setup([]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(value.rpc.fail).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
    expect(diagnosticCodes).toEqual(['claim_zero_eligible_rows']);
  });

  it('uses only claim-returned recipient and snapshot, and rejects invalid recipients before send', async () => {
    const value = setup([row({ out_recipient_email: 'not-an-email' })]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'INVALID_RECIPIENT');
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(result.retryScheduled).toBe(1);
    expect(diagnosticCodes).toEqual(['invalid_recipient']);
  });

  it.each([
    ['null', null, false],
    ['undefined', undefined, false],
    ['missing', undefined, true],
    ['number', 42, false],
    ['array', [], false],
    ['object', {}, false],
  ] as const)('rejects a malformed claim recipient field (%s) as a response-schema error', async (_label, recipient, missing) => {
    const claimedRow = row();
    if (missing) {
      delete (claimedRow as Partial<ClaimedCompletionReceipt>).out_recipient_email;
    } else {
      (claimedRow as unknown as Record<string, unknown>).out_recipient_email = recipient;
    }
    const value = setup([claimedRow]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);

    expect(diagnosticCodes).toEqual(['claim_response_schema_invalid']);
    expect(result).toMatchObject({ claimed: 0, errors: 1 });
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(value.rpc.fail).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'not-an-email'])('keeps malformed recipient strings on the invalid-recipient path: %s', async (recipient) => {
    const value = setup([row({ out_recipient_email: recipient })]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);

    expect(diagnosticCodes).toEqual(['invalid_recipient']);
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'INVALID_RECIPIENT');
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(result.retryScheduled).toBe(1);
  });

  it('fails malformed snapshots through the failure RPC without sending or acknowledging', async () => {
    const value = setup([row({ out_receipt_snapshot: { ...SNAPSHOT, unexpected: true } })]);
    const diagnosticCodes: string[] = [];
    await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'UNKNOWN');
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(diagnosticCodes).toContain('snapshot_mapping_rejected');
  });

  it('renders hostile receipt text as escaped HTML while preserving plain text and safe tracking route', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const value = setup([row({
      out_receipt_snapshot: { ...SNAPSHOT, game_name: hostile, reference: 'RF-TEST-123%2Ftrack' },
    })]);
    // The reference validator accepts only the fixed RF reference alphabet, so
    // URL delimiters are rejected before transport rather than entering a URL.
    const result = await runCompletionReceiptWorkerEngine(value.dependencies, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(result.retryScheduled).toBe(1);

    const validHostile = setup([row({ out_receipt_snapshot: { ...SNAPSHOT, game_name: hostile } })]);
    let sent: CompletionReceiptMessage | undefined;
    vi.mocked(validHostile.transport.send).mockImplementation(async (message) => { sent = message; });
    await runCompletionReceiptWorkerEngine(validHostile.dependencies, APP_ORIGIN);
    expect(sent?.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(sent?.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(sent?.text).toContain(hostile);
    expect(sent?.text).toContain('/track-order?ref=RF-TEST-123');
  });

  it('classifies a renderer rejection without exposing its exception or acknowledging', async () => {
    const value = setup();
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      render: () => { throw new Error('rendered body and private recipient'); },
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(diagnosticCodes).toEqual(['rendering_rejected']);
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'UNKNOWN');
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retryScheduled: 1, errors: 0 });
    expect(JSON.stringify(diagnosticCodes)).not.toMatch(/body|recipient|private/i);
  });

  it('maps only typed fake transport categories and never acknowledges a failed fake send', async () => {
    const value = setup([row()], async () => { throw new FakeTransportFailure('TIMEOUT'); });
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'TIMEOUT');
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(result.retryScheduled).toBe(1);
    expect(diagnosticCodes).toContain('fake_transport_rejected');
  });

  it('maps arbitrary transport exceptions to UNKNOWN and exposes no raw error in its summary', async () => {
    const value = setup([row()], async () => { throw new Error('secret recipient@example.invalid player=123456789'); });
    const result = await runCompletionReceiptWorkerEngine(value.dependencies, APP_ORIGIN);
    expect(value.rpc.fail).toHaveBeenCalledWith(row().out_id, row().out_lease_token, 'UNKNOWN');
    expect(JSON.stringify(result)).not.toMatch(/secret|recipient|123456789|player/i);
  });

  it('handles mixed results independently and classifies stale acknowledgment as a lost lease', async () => {
    const first = row();
    const second = row({ out_id: '10000000-0000-4000-8000-000000000004' });
    const value = setup([first, second]);
    vi.mocked(value.rpc.acknowledge).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).toHaveBeenCalledTimes(2);
    expect(value.rpc.acknowledge).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ fakeDeliveries: 2, acknowledged: 1, lostLeases: 1, errors: 0 });
    expect(diagnosticCodes).toEqual(['ack_rejected']);
  });

  it('records a rejected failure RPC as a lost lease without direct repair', async () => {
    const value = setup([row({ out_receipt_snapshot: null })]);
    const diagnosticCodes: string[] = [];
    vi.mocked(value.rpc.fail).mockResolvedValue({ out_status: 'rejected', out_next_attempt_at: null });
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.rpc.fail).toHaveBeenCalledTimes(1);
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(result.lostLeases).toBe(1);
    expect(diagnosticCodes).toEqual(['snapshot_mapping_rejected', 'fail_rejected']);
  });

  it.each([
    '2026-10-18T12:01:00.123456+00:00',
    '2026-10-18 12:01:00.123456+15:59',
    '2026-10-18T12:01:00-15:59',
  ])('accepts a valid zoned PostgREST retry timestamp: %s', async (timestamp) => {
    const value = setup([row({ out_receipt_snapshot: null })]);
    vi.mocked(value.rpc.fail).mockResolvedValue({ out_status: 'pending', out_next_attempt_at: timestamp });
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);

    expect(diagnosticCodes).toEqual(['snapshot_mapping_rejected']);
    expect(result.retryScheduled).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('accepts the E5.2 dead-letter timestamp and rejected-null result forms', async () => {
    const deadLetter = setup([row({ out_receipt_snapshot: null })]);
    vi.mocked(deadLetter.rpc.fail).mockResolvedValue({
      out_status: 'dead_letter',
      out_next_attempt_at: '2026-10-18T12:01:00.000000+00:00',
    });
    const deadLetterResult = await runCompletionReceiptWorkerEngine(deadLetter.dependencies, APP_ORIGIN);
    expect(deadLetterResult.deadLettered).toBe(1);
    expect(deadLetterResult.errors).toBe(0);

    const rejected = setup([row({ out_receipt_snapshot: null })]);
    vi.mocked(rejected.rpc.fail).mockResolvedValue({ out_status: 'rejected', out_next_attempt_at: null });
    const rejectedResult = await runCompletionReceiptWorkerEngine(rejected.dependencies, APP_ORIGIN);
    expect(rejectedResult.lostLeases).toBe(1);
    expect(rejectedResult.errors).toBe(0);
  });

  it('surfaces dead-letter as an aggregate count and does not reinterpret it as success', async () => {
    const value = setup([row({ out_receipt_snapshot: [] })]);
    const diagnosticCodes: string[] = [];
    vi.mocked(value.rpc.fail).mockResolvedValue({
      out_status: 'dead_letter',
      out_next_attempt_at: '2026-10-18T12:01:00Z',
    });
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(result.deadLettered).toBe(1);
    expect(result.acknowledged).toBe(0);
    expect(diagnosticCodes).toEqual(['snapshot_mapping_rejected']);
  });

  it.each([
    null,
    'unexpected',
    [],
    { out_next_attempt_at: null },
    { out_status: 'sent', out_next_attempt_at: null },
    { out_status: 'pending', out_next_attempt_at: 123 },
    { out_status: 'pending', out_next_attempt_at: null },
    { out_status: 'pending', out_next_attempt_at: 'not-a-timestamp' },
    { out_status: 'pending', out_next_attempt_at: '2026-02-30T12:01:00Z' },
    { out_status: 'pending', out_next_attempt_at: '2026-10-18' },
    { out_status: 'pending', out_next_attempt_at: '2026-10-18T12:01:00' },
    { out_status: 'pending', out_next_attempt_at: '2026-10-18T12:01:00+16:00' },
    { out_status: 'pending', out_next_attempt_at: '2026-10-18T12:01:00+00:60' },
    { out_status: 'dead_letter', out_next_attempt_at: 'invalid' },
    { out_status: 'dead_letter', out_next_attempt_at: null },
    { out_status: 'rejected', out_next_attempt_at: '2026-10-18T12:01:00Z' },
  ])('classifies malformed fail RPC response shapes without retrying', async (response) => {
    const value = setup([row({ out_receipt_snapshot: null })]);
    const diagnosticCodes: string[] = [];
    vi.mocked(value.rpc.fail).mockResolvedValue(response as never);
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.rpc.fail).toHaveBeenCalledTimes(1);
    expect(diagnosticCodes).toEqual(['snapshot_mapping_rejected', 'fail_response_schema_invalid']);
    expect(result).toMatchObject({ retryScheduled: 0, deadLettered: 0, lostLeases: 0, errors: 1 });
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
  });

  it('contains claim, acknowledgment, and failure RPC exceptions without leaking error text', async () => {
    const claimFailure = setup();
    const claimDiagnostics: string[] = [];
    vi.mocked(claimFailure.rpc.claim).mockRejectedValue(new Error('service-role-secret'));
    const claimResult = await runCompletionReceiptWorkerEngine({
      ...claimFailure.dependencies,
      onDiagnostic: (code) => claimDiagnostics.push(code),
    }, APP_ORIGIN);
    expect(JSON.stringify(claimResult)).not.toContain('service-role-secret');
    expect(claimFailure.transport.send).not.toHaveBeenCalled();
    expect(claimDiagnostics).toEqual(['claim_rpc_rejected']);

    const invalidClaimResponse = setup();
    vi.mocked(invalidClaimResponse.rpc.claim).mockResolvedValue(null as unknown as ClaimedCompletionReceipt[]);
    const schemaDiagnostics: string[] = [];
    await runCompletionReceiptWorkerEngine({
      ...invalidClaimResponse.dependencies,
      onDiagnostic: (code) => schemaDiagnostics.push(code),
    }, APP_ORIGIN);
    expect(schemaDiagnostics).toEqual(['claim_response_schema_invalid']);

    const ackFailure = setup();
    const ackDiagnostics: string[] = [];
    vi.mocked(ackFailure.rpc.acknowledge).mockRejectedValue(new Error('private response body'));
    const ackResult = await runCompletionReceiptWorkerEngine({
      ...ackFailure.dependencies,
      onDiagnostic: (code) => ackDiagnostics.push(code),
    }, APP_ORIGIN);
    expect(ackFailure.rpc.acknowledge).toHaveBeenCalledTimes(1);
    expect(ackFailure.rpc.fail).not.toHaveBeenCalled();
    expect(JSON.stringify(ackResult)).not.toContain('private response body');
    expect(ackDiagnostics).toContain('ack_rpc_rejected');

    const failFailure = setup([row({ out_receipt_snapshot: null })]);
    const failDiagnostics: string[] = [];
    vi.mocked(failFailure.rpc.fail).mockRejectedValue(new Error('upstream secrets'));
    const failResult = await runCompletionReceiptWorkerEngine({
      ...failFailure.dependencies,
      onDiagnostic: (code) => failDiagnostics.push(code),
    }, APP_ORIGIN);
    expect(failFailure.rpc.fail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failResult)).not.toContain('upstream secrets');
    expect(failDiagnostics).toEqual(['snapshot_mapping_rejected', 'fail_rpc_rejected']);
  });

  it('rejects invalid canonical origins and out-of-bound batches before any RPC', async () => {
    const value = setup();
    const diagnosticCodes: string[] = [];
    const dependencies = { ...value.dependencies, onDiagnostic: (code: CompletionReceiptWorkerDiagnostic) => diagnosticCodes.push(code) };
    const badOrigin = await runCompletionReceiptWorkerEngine(dependencies, 'https://attacker.example/path');
    const badBatch = await runCompletionReceiptWorkerEngine(dependencies, APP_ORIGIN, 6);
    expect(badOrigin.errors).toBe(1);
    expect(badBatch.errors).toBe(1);
    expect(value.rpc.claim).not.toHaveBeenCalled();
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(diagnosticCodes).toEqual(['invalid_origin', 'invalid_batch']);
  });

  it('rejects malformed claim identity and lease fields without acknowledging or mutating', async () => {
    const value = setup([row({ out_lease_token: 'not-a-uuid' })]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.fail).not.toHaveBeenCalled();
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(diagnosticCodes).toEqual(['invalid_claimed_row']);
  });

  it('does not process claims beyond E5.2 maximum attempt count', async () => {
    const value = setup([row({ out_attempt_count: 6 })]);
    const diagnosticCodes: string[] = [];
    const result = await runCompletionReceiptWorkerEngine({
      ...value.dependencies,
      onDiagnostic: (code) => diagnosticCodes.push(code),
    }, APP_ORIGIN);
    expect(value.transport.send).not.toHaveBeenCalled();
    expect(value.rpc.acknowledge).not.toHaveBeenCalled();
    expect(value.rpc.fail).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(diagnosticCodes).toEqual(['invalid_claimed_row']);
  });
});
