import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV,
  deriveCustomerConfirmationResendKey,
} from './customerConfirmationResendKey';

const TEST_SECRET = 'synthetic-confirmation-resend-secret-32';

describe('customer confirmation resend key derivation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env[CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV] = TEST_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('derives a deterministic lowercase 64-character email key', () => {
    const first = deriveCustomerConfirmationResendKey('email', ' Customer@Example.COM ');
    const second = deriveCustomerConfirmationResendKey('email', 'customer@example.com');

    expect(first).toBe('4658b5cc35dd921e58f71819a5307c7469fe3bbc33ed0782fef27e13e25534e9');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps different identifiers and purposes domain-separated', () => {
    const emailKey = deriveCustomerConfirmationResendKey('email', 'customer@example.com');
    const otherEmailKey = deriveCustomerConfirmationResendKey('email', 'other@example.com');
    const networkKey = deriveCustomerConfirmationResendKey('network', 'verified-network-key');

    expect(emailKey).not.toBe(otherEmailKey);
    expect(emailKey).not.toBe(networkKey);
  });

  it.each([
    ['', 'email'],
    ['not-an-email', 'email'],
    [' ', 'network'],
    ['x'.repeat(513), 'network'],
    ['\u0000network', 'network'],
  ] as const)('rejects invalid %s identifiers', (identifier, purpose) => {
    expect(() => deriveCustomerConfirmationResendKey(purpose, identifier)).toThrow();
  });

  it('fails closed when the dedicated secret is missing or weak', () => {
    delete process.env[CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV];
    expect(() => deriveCustomerConfirmationResendKey('email', 'customer@example.com')).toThrow();

    process.env[CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV] = 'too-short';
    expect(() => deriveCustomerConfirmationResendKey('email', 'customer@example.com')).toThrow();
  });

  it('does not fall back to the Supabase service-role secret', () => {
    delete process.env[CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET_ENV];
    process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SECRET;

    expect(() => deriveCustomerConfirmationResendKey('email', 'customer@example.com')).toThrow();
  });

  it('rejects browser execution before deriving a key', () => {
    vi.stubGlobal('window', {});

    expect(() => deriveCustomerConfirmationResendKey('email', 'customer@example.com')).toThrow(
      'server-only',
    );
  });

  it('only returns opaque keys and performs no request or cookie operations', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const document = { cookie: '' };
    vi.stubGlobal('document', document);

    const key = deriveCustomerConfirmationResendKey('network', 'verified-network-key');

    expect(key).not.toContain('verified-network-key');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
    fetchSpy.mockRestore();
  });
});
