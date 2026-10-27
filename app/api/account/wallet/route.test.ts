import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveCustomerSession: vi.fn(),
  walletMaybeSingle: vi.fn(),
  packagesOrder: vi.fn(),
  settingsMaybeSingle: vi.fn(),
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
    client: { from },
  });
}

describe('GET /api/account/wallet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    activeSession();
    mocks.walletMaybeSingle.mockResolvedValue({ data: { user_id: 'customer-a', balance_coins: 0 }, error: null });
    mocks.packagesOrder.mockResolvedValue({ data: [], error: null });
    mocks.settingsMaybeSingle.mockResolvedValue({ data: { enabled: false, topups_enabled: false, spending_enabled: false, centavos_per_coin: 100 }, error: null });
  });

  it('returns explicit disabled state without exposing packages', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, packages: [], topupsEnabled: false, spendingEnabled: false });
  });

  it('fails visibly if settings cannot be read instead of claiming the wallet is disabled', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'Could not load wallet settings.' });
  });

  it('fails visibly if enabled coin packages cannot be read', async () => {
    mocks.settingsMaybeSingle.mockResolvedValueOnce({ data: { enabled: true, topups_enabled: true, spending_enabled: true, centavos_per_coin: 100 }, error: null });
    mocks.packagesOrder.mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'Could not load available coin packages.' });
  });

  it('does not query privileged wallet data without an active customer session', async () => {
    mocks.getActiveCustomerSession.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.settingsMaybeSingle).not.toHaveBeenCalled();
  });
});
