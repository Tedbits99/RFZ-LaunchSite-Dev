import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderCompletionReceiptFromSnapshot, validateCanonicalAppOrigin } from '../../../lib/completionReceiptCore';
import { createCompletionReceiptWorkerHandler, type WorkerConfig } from './handler';
import { mapE51ReceiptSnapshot } from './receiptSnapshot';
import type { CompletionReceiptMessage } from './transportContract';

const TEST_SECRET = 'test-invocation-secret-0123456789abcdef';
const APP_ORIGIN = 'https://runfazone.com';
const VALID_CONFIG: WorkerConfig = {
  enabled: 'true',
  invocationSecret: TEST_SECRET,
  appOrigin: APP_ORIGIN,
};
const VALID_SNAPSHOT = {
  reference: 'RF-ABC123',
  total_cents: 12345,
  payment_method: 'gcash',
  game_name: 'Mobile Legends',
  package_name: '86 Diamonds',
  quantity: 2,
  masked_player_identifier: '*****0999',
  completed_at: '2026-10-17T19:00:00.000Z',
};

function request(authorization?: string, origin?: string, body?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  if (origin !== undefined) headers.set('origin', origin);
  return new Request('https://worker.example.test/functions/v1/completion-receipt-email-worker', {
    method: 'POST',
    headers,
    body,
  });
}

function fakeTransport() {
  return { send: vi.fn((_message: CompletionReceiptMessage) => Promise.resolve()) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('E5.3A disabled completion receipt worker', () => {
  it.each([
    ['absent', null, 200, 'disabled'],
    ['explicit false', 'false', 200, 'disabled'],
    ['empty string', '', 503, 'unavailable'],
    ['whitespace', ' false ', 503, 'unavailable'],
    ['malformed true-like value', 'TRUE', 503, 'unavailable'],
    ['ambiguous value', 'true,false', 503, 'unavailable'],
  ])('fails closed when the feature flag is %s', async (_label, enabled, status, expectedStatus) => {
    const transport = fakeTransport();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const handler = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, enabled }, { transport });
    const response = await handler(request(`Bearer ${TEST_SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.status ?? body.error.toLowerCase().replaceAll(' ', '_')).toContain(expectedStatus);
    expect(transport.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps invocation authentication default-deny even while the worker is disabled', async () => {
    const handler = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, enabled: null });
    expect((await handler(request())).status).toBe(401);
    expect((await createCompletionReceiptWorkerHandler({
      ...VALID_CONFIG,
      enabled: null,
      invocationSecret: null,
    })(request())).status).toBe(503);
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'Bearer xest-invocation-secret-0123456789abcdef'],
    ['malformed', 'Basic test-invocation-secret-0123456789abcdef'],
    ['malformed bearer', 'Bearer short'],
    ['shorter length', `Bearer ${TEST_SECRET.slice(0, -1)}`],
    ['longer length', `Bearer ${TEST_SECRET}x`],
    ['oversized length', `Bearer ${'x'.repeat(4096)}`],
  ])('rejects %s authorization before any worker action', async (_label, authorization) => {
    const transport = fakeTransport();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const handler = createCompletionReceiptWorkerHandler(VALID_CONFIG, { transport });
    const response = await handler(request(authorization, 'https://trusted-looking.example'));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(TEST_SECRET);
    expect(transport.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not treat Origin as authentication and accepts only the injected test bearer secret', async () => {
    const handler = createCompletionReceiptWorkerHandler(VALID_CONFIG);
    const originOnly = await handler(request(undefined, 'https://runfazone.com'));
    expect(originOnly.status).toBe(401);

    const authenticated = await handler(request(`Bearer ${TEST_SECRET}`, 'https://untrusted.example'));
    expect(authenticated.status).toBe(503);
    expect(await authenticated.json()).toEqual({ status: 'not_implemented' });
  });

  it('fails closed when enabled without a valid invocation secret or canonical origin', async () => {
    const noSecret = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, invocationSecret: null });
    expect((await noSecret(request(`Bearer ${TEST_SECRET}`))).status).toBe(503);
    const malformedSecret = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, invocationSecret: 'short secret' });
    expect((await malformedSecret(request(`Bearer ${TEST_SECRET}`))).status).toBe(503);

    const badOrigin = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, appOrigin: 'https://runfazone.com/orders' });
    expect((await badOrigin(request(`Bearer ${TEST_SECRET}`))).status).toBe(503);
  });

  it('makes no network, database, or transport calls when disabled', async () => {
    const transport = fakeTransport();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const handler = createCompletionReceiptWorkerHandler({ ...VALID_CONFIG, enabled: null }, { transport });
    const response = await handler(request(`Bearer ${TEST_SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('never claims rows or invokes the injected fake transport, even when enabled and authorized', async () => {
    const transport = fakeTransport();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const logSpy = vi.spyOn(console, 'error');
    const handler = createCompletionReceiptWorkerHandler(VALID_CONFIG, { transport });
    const response = await handler(request(`Bearer ${TEST_SECRET}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_implemented' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not expose recipient, player data, or secrets in disabled/error responses', async () => {
    const recipient = 'private-customer@example.test';
    const playerId = 'raw-player-id-secret';
    const response = await createCompletionReceiptWorkerHandler({
      ...VALID_CONFIG,
      enabled: 'enabled?',
    });
    const errorLog = vi.spyOn(console, 'error');
    const infoLog = vi.spyOn(console, 'log');
    const result = await response(request(`Bearer ${TEST_SECRET}`, undefined, JSON.stringify({ recipient, playerId, secret: TEST_SECRET })));
    const body = await result.text();

    expect(body).not.toContain(recipient);
    expect(body).not.toContain(playerId);
    expect(body).not.toContain(TEST_SECRET);
    expect(body).toBe('{"error":"Worker unavailable."}');
    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });
});

describe('runtime-neutral E4 renderer and E5.1 snapshot mapping', () => {
  it('requires a canonical explicit origin and rejects URL components that could alter the tracking destination', () => {
    expect(validateCanonicalAppOrigin(APP_ORIGIN)).toBe(APP_ORIGIN);
    for (const invalid of [
      null,
      'https://runfazone.com/',
      'https://runfazone.com/orders',
      'https://runfazone.com?next=attacker.test',
      'https://user:pass@runfazone.com',
      'http://localhost:3000',
      'javascript:alert(1)',
    ]) {
      expect(() => validateCanonicalAppOrigin(invalid)).toThrow();
    }
  });

  it('maps exactly the authoritative E5.1 fields and keeps an already-masked identifier masked', () => {
    const mapped = mapE51ReceiptSnapshot(VALID_SNAPSHOT, APP_ORIGIN);
    const receipt = renderCompletionReceiptFromSnapshot(mapped.input, mapped.appOrigin);

    expect(mapped.input).toEqual({
      publicOrderReference: 'RF-ABC123',
      totalCents: 12345,
      paymentMethod: 'gcash',
      gameName: 'Mobile Legends',
      packageName: '86 Diamonds',
      quantity: 2,
      maskedPlayerIdentifier: '*****0999',
      completedAt: '2026-10-17T19:00:00.000Z',
    });
    expect(receipt.html).toContain('*****0999');
    expect(receipt.text).toContain('*****0999');
    expect(receipt.html).not.toContain('raw-player-id');
    expect(receipt.text).not.toContain('raw-player-id');
  });

  it('rejects missing/extra snapshot fields, malformed types, and raw unmasked identifiers without leaking values', () => {
    const invalidSnapshots: unknown[] = [
      null,
      undefined,
      [],
      'not an object',
      42,
      true,
      { ...VALID_SNAPSHOT, unexpected: 'private-customer@example.test' },
      (({ game_name: _omit, ...rest }) => rest)(VALID_SNAPSHOT),
      { ...VALID_SNAPSHOT, total_cents: '12345' },
      { ...VALID_SNAPSHOT, quantity: 0 },
      { ...VALID_SNAPSHOT, masked_player_identifier: 'raw-player-id-secret' },
      { ...VALID_SNAPSHOT, completed_at: 'not-a-time' },
      { ...VALID_SNAPSHOT, completed_at: '2026-10-17' },
      { ...VALID_SNAPSHOT, completed_at: '2026-02-30T12:00:00Z' },
      { ...VALID_SNAPSHOT, completed_at: '2026-10-17T12:00:00+25:00' },
      { ...VALID_SNAPSHOT, completed_at: '2026-10-17T12:00:00+01:60' },
      { ...VALID_SNAPSHOT, game_name: 'Hidden\u202eText' },
      { ...VALID_SNAPSHOT, package_name: 'Zero\u200bWidth' },
    ];

    for (const snapshot of invalidSnapshots) {
      try {
        mapE51ReceiptSnapshot(snapshot, APP_ORIGIN);
        throw new Error('invalid fixture unexpectedly mapped');
      } catch (error) {
        expect((error as Error).message).toBe('Invalid authoritative receipt snapshot.');
        expect((error as Error).message).not.toContain('private-customer@example.test');
        expect((error as Error).message).not.toContain('raw-player-id-secret');
      }
    }
  });

  it('accepts PostgreSQL timestamptz JSON variants and enforces PostgreSQL offset boundaries', () => {
    for (const completedAt of [
      '2026-10-17T19:00:00Z',
      '2026-10-17T19:00:00.123456+00:00',
      '2026-10-17 19:00:00.1-07:30',
      '2026-10-17T19:00:00+15:59',
      '2026-10-17T19:00:00-15:59',
    ]) {
      expect(mapE51ReceiptSnapshot({ ...VALID_SNAPSHOT, completed_at: completedAt }, APP_ORIGIN).input.completedAt)
        .toBe(completedAt);
    }

    for (const completedAt of [
      '2026-10-17',
      'October 17, 2026 19:00 UTC',
      '2026-02-29T19:00:00Z',
      '2026-10-17T19:00:00+16:00',
      '2026-10-17T19:00:00-16:00',
      '2026-10-17T19:00:00+24:00',
      '2026-10-17T19:00:00+00:60',
      '2026-10-17T19:00:00-15:60',
    ]) {
      expect(() => mapE51ReceiptSnapshot({ ...VALID_SNAPSHOT, completed_at: completedAt }, APP_ORIGIN)).toThrow(
        'Invalid authoritative receipt snapshot.',
      );
    }
  });

  it('preserves HTML escaping, plain text, pricing, Manila time, and a fixed tracking link', () => {
    const mapped = mapE51ReceiptSnapshot({
      ...VALID_SNAPSHOT,
      game_name: 'A & B <Game>',
      package_name: '"Special" Pack',
    }, APP_ORIGIN);
    const receipt = renderCompletionReceiptFromSnapshot(mapped.input, mapped.appOrigin);

    expect(receipt.subject).toBe('Top-Up Successful — RF-ABC123');
    expect(receipt.html).toContain('A &amp; B &lt;Game&gt;');
    expect(receipt.html).toContain('&quot;Special&quot; Pack');
    expect(receipt.text).toContain('A & B <Game>');
    expect(receipt.text).toContain('₱123.45');
    expect(receipt.text).toContain('October 18, 2026');
    expect(receipt.html).toContain('https://runfazone.com/track-order?ref=RF-ABC123');
    expect(receipt.html).toContain('existing verification details before showing private information');
    expect(receipt.text).toContain('View Your Order: https://runfazone.com/track-order?ref=RF-ABC123');
    expect(receipt.html).not.toContain('javascript:');
    expect(receipt.html).not.toContain('runfazone.com@');
    expect(`${receipt.html}\n${receipt.text}`).not.toContain('__rfz_order_access_hash');
  });

  it('escapes hostile HTML and keeps tracking references within the constrained URL grammar', () => {
    const mapped = mapE51ReceiptSnapshot({
      ...VALID_SNAPSHOT,
      reference: 'RF-abc-123',
      game_name: `<script>alert("x")</script> & 'quoted'`,
      package_name: `</td><img src=x onerror="alert(1)">`,
    }, APP_ORIGIN);
    const receipt = renderCompletionReceiptFromSnapshot(mapped.input, mapped.appOrigin);

    expect(receipt.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#039;quoted&#039;');
    expect(receipt.html).toContain('&lt;/td&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(receipt.html).not.toContain('<script>');
    expect(receipt.html).not.toContain('<img');
    expect(receipt.html).toContain('https://runfazone.com/track-order?ref=RF-abc-123');

    for (const reference of ['RF-ABC%2Fadmin', 'RF-ABC?next=evil', 'RF-ABC/../admin']) {
      expect(() => mapE51ReceiptSnapshot({ ...VALID_SNAPSHOT, reference }, APP_ORIGIN)).toThrow(
        'Invalid authoritative receipt snapshot.',
      );
    }
  });
});
