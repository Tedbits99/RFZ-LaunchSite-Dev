import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { HitPayAdapter, type ProviderConfig } from './paymentProviderAdapters';

const adapter = new HitPayAdapter();

function makeConfig(credentials: Record<string, string>, isTestMode = false): ProviderConfig {
  return {
    providerName: 'hitpay',
    apiUrl: '',
    isTestMode,
    currency: 'PHP',
    credentials,
    metadata: {},
  };
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

const SALT = 'hitpay-signing-salt';

// Signature format preserved from the existing implementation:
// HMAC-SHA256 over sorted `keyvalue` concatenation of every field except `hmac`.
function sign(fields: Record<string, string>): string {
  return createHmac('sha256', SALT)
    .update(
      Object.entries(fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}${v}`)
        .join(''),
    )
    .digest('hex');
}

const SIGNED_FIELDS = {
  payment_request_id: 'pr_123',
  status: 'completed',
  amount: '150.00',
};

const SIGNED_BODY = new URLSearchParams({ ...SIGNED_FIELDS, hmac: sign(SIGNED_FIELDS) }).toString();

describe('HitPayAdapter.validateWebhook (fail-closed)', () => {
  it('rejects when both signing credentials are absent', async () => {
    const res = await adapter.validateWebhook(makeConfig({}), makeRequest(SIGNED_BODY));
    expect(res.valid).toBe(false);
    expect(res.error).toContain('signing secret not configured');
  });

  it('rejects when the received HMAC signature is absent', async () => {
    const res = await adapter.validateWebhook(
      makeConfig({ webhook_secret: SALT }),
      makeRequest(new URLSearchParams(SIGNED_FIELDS).toString()),
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain('signature missing');
  });

  it('rejects a signature that does not match', async () => {
    const tampered = new URLSearchParams({ ...SIGNED_FIELDS, hmac: 'deadbeef' }).toString();
    const res = await adapter.validateWebhook(makeConfig({ webhook_secret: SALT }), makeRequest(tampered));
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Invalid HMAC signature');
  });

  it('accepts a correctly signed request and extracts fields', async () => {
    const res = await adapter.validateWebhook(makeConfig({ webhook_secret: SALT }), makeRequest(SIGNED_BODY));
    expect(res.valid).toBe(true);
    expect(res.providerReference).toBe('pr_123');
    expect(res.status).toBe('PAID');
    expect(res.amountCents).toBe(15000);
  });

  it('accepts a correctly signed request using api_salt fallback', async () => {
    const res = await adapter.validateWebhook(
      makeConfig({ api_salt: SALT }),
      makeRequest(SIGNED_BODY),
    );
    expect(res.valid).toBe(true);
    expect(res.providerReference).toBe('pr_123');
  });

  it('rejects a malformed (non-parseable) request body', async () => {
    // URLSearchParams tolerates most strings; use an object that cannot be read
    const badRequest = { text: () => Promise.reject(new Error('stream failure')) } as unknown as Request;
    const res = await adapter.validateWebhook(makeConfig({ webhook_secret: SALT }), badRequest);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('stream failure');
  });
});
