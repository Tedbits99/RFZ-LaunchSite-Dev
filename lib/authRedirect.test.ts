import { describe, expect, it } from 'vitest';
import { getCustomerLoginUrl, getRecoveryCallbackUrl, getSafeInternalPath } from './authRedirect';

describe('customer return destinations', () => {
  it('preserves a safe relative customer route and its query', () => {
    expect(getSafeInternalPath('/account/orders/abc?tab=recent')).toBe('/account/orders/abc?tab=recent');
    expect(getCustomerLoginUrl('/account/orders/abc')).toBe('/login?next=%2Faccount%2Forders%2Fabc');
  });

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/%5c%5cevil.example',
    '/account\u0000',
    'javascript:alert(1)',
    null,
    42,
  ])('rejects unsafe or malformed destination %s', (value) => {
    expect(getSafeInternalPath(value)).toBe('/account');
  });
});

describe('trusted authentication callbacks', () => {
  it('marks recovery callbacks so the code exchange uses the recovery cookie namespace', () => {
    const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;
    try {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
      expect(getRecoveryCallbackUrl()).toBe('https://example.test/auth/callback?type=recovery');
    } finally {
      if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
    }
  });

  it('fails closed when the configured application origin is absent', () => {
    const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;
    try {
      delete process.env.NEXT_PUBLIC_APP_URL;
      expect(getRecoveryCallbackUrl()).toBeNull();
    } finally {
      if (previousOrigin !== undefined) process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
    }
  });
});
