import { describe, expect, it } from 'vitest';
import { getCustomerLoginUrl, getSafeInternalPath } from './authRedirect';

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
