import { describe, expect, it } from 'vitest';
import { shouldLoadRfCoinLedger } from './rfCoinWalletStatus';

describe('RF Coins ledger availability', () => {
  it('loads customer history when infrastructure is ready, independent of release toggles', () => {
    expect(shouldLoadRfCoinLedger(true, 'ready')).toBe(true);
    expect(shouldLoadRfCoinLedger(false, 'ready')).toBe(false);
    expect(shouldLoadRfCoinLedger(true, 'disabled')).toBe(false);
    expect(shouldLoadRfCoinLedger(true, 'not_deployed')).toBe(false);
    expect(shouldLoadRfCoinLedger(true, 'not_configured')).toBe(false);
    expect(shouldLoadRfCoinLedger(true, 'incomplete')).toBe(false);
    expect(shouldLoadRfCoinLedger(true, undefined)).toBe(false);
  });
});
