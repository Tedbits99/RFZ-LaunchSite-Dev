import { describe, expect, it } from 'vitest';
import { resolveCustomerWalletSummary } from './customerWalletSummary';

describe('customer wallet header summary', () => {
  it('shows a genuine zero only when the authenticated API returns a ready wallet row', () => {
    expect(resolveCustomerWalletSummary(200, {
      enabled: true,
      walletStatus: 'ready',
      wallet: { balance_coins: 0 },
      topupsEnabled: false,
      packages: [],
    })).toEqual({ kind: 'ready', balance: 0, canAddFunds: false });
  });

  it('never fabricates zero when the wallet schema is missing or disabled', () => {
    expect(resolveCustomerWalletSummary(200, {
      enabled: false, walletStatus: 'not_deployed', wallet: null, packages: [],
    })).toEqual({ kind: 'unavailable', message: 'Wallet setup is not available in this environment yet.' });
    expect(resolveCustomerWalletSummary(200, {
      enabled: true, walletStatus: 'ready', wallet: null, packages: [],
    }).kind).toBe('unavailable');
  });

  it('does not expose a personal balance to anonymous sessions', () => {
    expect(resolveCustomerWalletSummary(401, { wallet: { balance_coins: 1250 } })).toEqual({ kind: 'anonymous' });
  });

  it('offers Add Funds only when the server enables funding and returns an active package', () => {
    const ready = (packages: unknown[]) => resolveCustomerWalletSummary(200, {
      enabled: true, walletStatus: 'ready', wallet: { balance_coins: 1250 }, topupsEnabled: true, packages,
    });
    expect(ready([])).toMatchObject({ kind: 'ready', canAddFunds: false });
    expect(ready([{ id: 'server-priced-package' }])).toMatchObject({ kind: 'ready', canAddFunds: true });
  });

  it('rejects non-integer, negative, and unsafe balances rather than rounding them', () => {
    for (const balance of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0']) {
      expect(resolveCustomerWalletSummary(200, {
        enabled: true, walletStatus: 'ready', wallet: { balance_coins: balance }, packages: [],
      }).kind).toBe('unavailable');
    }
  });
});
