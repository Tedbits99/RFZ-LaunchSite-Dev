import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveCustomerSession: vi.fn(),
  walletMaybeSingle: vi.fn(),
  packagesOrder: vi.fn(),
  settingsMaybeSingle: vi.fn(),
  walletInitRpc: vi.fn(),
}));

vi.mock('@/lib/customerSession', () => ({
  getActiveCustomerSession: mocks.getActiveCustomerSession,
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.settingsMaybeSingle })),
      })),
    })),
  },
}));

import { GET } from './route';

function activeSession() {
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => table === 'rf_coin_wallets'
      ? { eq: vi.fn(() => ({ maybeSingle: mocks.walletMaybeSingle })) }
      : { eq: vi.fn(() => ({ order: mocks.packagesOrder })) }),
  }));
  mocks.getActiveCustomerSession.mockResolvedValue({
    user: { id: 'customer-a' },
    client: { from, rpc: mocks.walletInitRpc },
  });
}

describe('GET /api/account/wallet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    activeSession();
    mocks.walletMaybeSingle.mockResolvedValue({ data: { user_id: 'customer-a', balance_coins: 0 }, error: null });
    mocks.packagesOrder.mockResolvedValue({ data: [], error: null });
    mocks.settingsMaybeSingle.mockResolvedValue({ data: { enabled: false, topups_enabled: false, spending_enabled: false, centavos_per_coin: 100 }, error: null });
    mocks.walletInitRpc.mockResolvedValue({ data: null, error: null });
  });

  it('returns an actual customer wallet row read-only while database features are disabled', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      wallet: { user_id: 'customer-a', balance_coins: 0 },
      enabled: false,
      databaseEnabled: false,
      infrastructureReady: true,
      fundingEnabled: false,
      packages: [],
      topupsEnabled: false,
      spendingEnabled: false,
      walletStatus: 'ready',
    });
  });

  it('fails visibly if settings cannot be read instead of claiming the wallet is disabled', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'Could not load wallet settings.' });
  });

  it('reports the RF Coins feature as not deployed when its settings table is absent', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.rf_coin_settings' in the schema cache" },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      wallet: null,
      enabled: false,
      topupsEnabled: false,
      spendingEnabled: false,
      walletStatus: 'not_deployed',
    });
    expect(mocks.walletMaybeSingle).not.toHaveBeenCalled();
  });

  it('does not call an unseeded settings row a deployed or working wallet', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, walletStatus: 'not_configured', wallet: null });
    expect(mocks.walletMaybeSingle).not.toHaveBeenCalled();
  });

  it('does not initialize a wallet while the static financial release locks are closed', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: { enabled: true, topups_enabled: false, spending_enabled: true, centavos_per_coin: 100 }, error: null });
    mocks.walletMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      wallet: null,
      databaseEnabled: true,
      infrastructureReady: true,
      fundingEnabled: false,
      spendingEnabled: false,
      walletStatus: 'ready',
    });
    expect(mocks.walletInitRpc).not.toHaveBeenCalled();
    expect(mocks.walletMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('fails closed if wallet settings exist but the wallet relation is missing', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({
      data: { enabled: true, topups_enabled: false, spending_enabled: true, centavos_per_coin: 100 },
      error: null,
    });
    mocks.walletMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation public.rf_coin_wallets does not exist' },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      wallet: null,
      enabled: false,
      infrastructureReady: false,
      fundingEnabled: false,
      topupsEnabled: false,
      spendingEnabled: false,
      walletStatus: 'incomplete',
    });
  });

  it('keeps Add Funds unavailable even if database flags and packages are enabled', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: { enabled: true, topups_enabled: true, spending_enabled: true, centavos_per_coin: 100 }, error: null });
    mocks.packagesOrder.mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      topupsEnabled: false,
      packages: [],
      wallet: { user_id: 'customer-a', balance_coins: 0 },
    });
    expect(mocks.packagesOrder).not.toHaveBeenCalled();
  });

  it('does not query privileged wallet data without an active customer session', async () => {
    mocks.getActiveCustomerSession.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.settingsMaybeSingle).not.toHaveBeenCalled();
  });
});
