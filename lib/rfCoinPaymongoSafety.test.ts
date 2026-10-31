import { describe, expect, it } from 'vitest';
import { isSafeRfCoinPaymongoSandbox, type RfCoinPaymongoConfig } from '../supabase/functions/_shared/rfCoinPaymongoSafety';

const safeTestConfig: RfCoinPaymongoConfig = {
  providerName: 'paymongo',
  providerType: 'automated',
  enabled: true,
  testMode: true,
  secretKey: 'sk_test_synthetic_only',
  apiUrl: 'https://api.paymongo.com/v1',
};

describe('RF Coins PayMongo sandbox gate', () => {
  it('permits only an enabled PayMongo test configuration with a test key', () => {
    expect(isSafeRfCoinPaymongoSandbox(safeTestConfig)).toBe(true);
  });

  it('fails closed for live mode, live keys, disabled providers, and non-PayMongo providers', () => {
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, testMode: false })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, secretKey: 'sk_live_synthetic_only' })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, enabled: false })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, providerName: 'other' })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, providerType: 'manual' })).toBe(false);
  });

  it('rejects alternate hosts, insecure URLs, URL credentials, and query overrides', () => {
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, apiUrl: 'https://api.paymongo.com.attacker.example/v1' })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, apiUrl: 'http://api.paymongo.com/v1' })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, apiUrl: 'https://user:pass@api.paymongo.com/v1' })).toBe(false);
    expect(isSafeRfCoinPaymongoSandbox({ ...safeTestConfig, apiUrl: 'https://api.paymongo.com/v1?host=attacker.example' })).toBe(false);
  });
});
