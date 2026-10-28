import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveCustomerSession: vi.fn(),
  maybeSingle: vi.fn(),
  eqId: vi.fn(),
  eqUser: vi.fn(),
}));

vi.mock('@/lib/customerSession', () => ({
  getActiveCustomerSession: mocks.getActiveCustomerSession,
}));

import { GET } from './route';

const topupId = '6e419dad-ee97-4f66-9b31-bc31a63b72fb';
const params = Promise.resolve({ topupId });

function activeSession(userId = 'customer-a') {
  mocks.getActiveCustomerSession.mockResolvedValue({
    user: { id: userId },
    client: { from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => {
          if (column === 'id') mocks.eqId(column, value);
          if (column === 'user_id') mocks.eqUser(column, value);
          return column === 'id' ? { eq: (userColumn: string, userValue: string) => {
            mocks.eqUser(userColumn, userValue);
            return { maybeSingle: mocks.maybeSingle };
          } } : { maybeSingle: mocks.maybeSingle };
        }),
      })),
    })) },
  });
}

describe('GET /api/account/wallet/topup/[topupId]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    activeSession();
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: topupId,
        coins: 100,
        bonus_coins: 10,
        price_cents: 10000,
        status: 'PENDING',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        credited_at: null,
      },
      error: null,
    });
  });

  it('returns only the active customer-owned top-up status without provider credentials', async () => {
    const response = await GET(new Request('https://example.test'), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ topup: { id: topupId, status: 'PENDING', coins: 100, bonusCoins: 10 } });
    expect(mocks.eqId).toHaveBeenCalledWith('id', topupId);
    expect(mocks.eqUser).toHaveBeenCalledWith('user_id', 'customer-a');
  });

  it('denies anonymous access before querying top-ups', async () => {
    mocks.getActiveCustomerSession.mockResolvedValueOnce(null);
    const response = await GET(new Request('https://example.test'), { params });
    expect(response.status).toBe(401);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it('does not reveal rows outside the current customer scope', async () => {
    activeSession('customer-b');
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const response = await GET(new Request('https://example.test'), { params });
    expect(response.status).toBe(404);
  });

  it('rejects malformed top-up IDs before database access', async () => {
    const response = await GET(new Request('https://example.test'), { params: Promise.resolve({ topupId: 'not-an-id' }) });
    expect(response.status).toBe(404);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it('fails closed on unknown status values and database failures', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { status: 'MAGICALLY_PAID' }, error: null });
    expect((await GET(new Request('https://example.test'), { params })).status).toBe(404);
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42P01' } });
    expect((await GET(new Request('https://example.test'), { params })).status).toBe(503);
  });
});
