import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveCustomerSession: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));

vi.mock('@/lib/customerSession', () => ({ getActiveCustomerSession: mocks.getActiveCustomerSession }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./ProfileClient', () => ({ default: () => null }));

import AccountProfile from './page';

describe('account profile route boundary', () => {
  beforeEach(() => vi.resetAllMocks());

  it('redirects anonymous requests before rendering the client profile', async () => {
    mocks.getActiveCustomerSession.mockResolvedValue(null);

    await expect(AccountProfile()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders the profile client after an active customer session is verified', async () => {
    mocks.getActiveCustomerSession.mockResolvedValue({ user: { id: 'customer-1' } });

    const page = await AccountProfile();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(page).toBeTruthy();
  });
});
