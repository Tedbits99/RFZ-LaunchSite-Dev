import { describe, expect, it } from 'vitest';
import { hasAuthorizedTransactionalEmailRequest } from './transactionalEmailAuth';

const SERVICE_KEY = 'synthetic-service-role-key';

function request(authorization?: string): Request {
  return new Request('https://example.test/functions/v1/send-transactional-email', {
    headers: authorization ? { authorization } : undefined,
  });
}

describe('transactional email internal authorization', () => {
  it.each([
    ['missing authorization', undefined],
    ['malformed authorization', 'Basic synthetic-service-role-key'],
    ['wrong bearer value', 'Bearer wrong-key'],
    ['empty bearer value', 'Bearer '],
  ])('denies %s', (_label, authorization) => {
    expect(hasAuthorizedTransactionalEmailRequest(request(authorization), SERVICE_KEY)).toBe(false);
  });

  it('accepts the exact server-side service-role bearer value', () => {
    expect(hasAuthorizedTransactionalEmailRequest(request(`Bearer ${SERVICE_KEY}`), SERVICE_KEY)).toBe(true);
  });

  it('fails closed when the configured service-role key is missing', () => {
    expect(hasAuthorizedTransactionalEmailRequest(request('Bearer anything'), '')).toBe(false);
  });

  it.each(['payment_success', 'fulfillment_failed', 'guest_order_access'])(
    'uses the same authorization decision for the %s template', () => {
      expect(hasAuthorizedTransactionalEmailRequest(request(), SERVICE_KEY)).toBe(false);
      expect(hasAuthorizedTransactionalEmailRequest(request(`Bearer ${SERVICE_KEY}`), SERVICE_KEY)).toBe(true);
    },
  );

  it('does not authorize based on payload-like headers or caller claims', () => {
    const forged = new Request('https://example.test/functions/v1/send-transactional-email', {
      headers: {
        'x-role': 'service_role',
        'x-user-role': 'service_role',
        authorization: 'Bearer forged-key',
      },
    });
    expect(hasAuthorizedTransactionalEmailRequest(forged, SERVICE_KEY)).toBe(false);
  });
});
